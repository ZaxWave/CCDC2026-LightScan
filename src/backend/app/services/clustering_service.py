"""
clustering_service.py
空间聚类 + 视觉 ReID 融合算法

核心思想
--------
判断两次拍摄是否为「同一个病害点」，需要同时通过两道关卡：

  关卡 1 — 空间距离（GPS）
    两条记录的地理距离 < SPATIAL_THRESHOLD_M（默认 5 m）
    且病害类型相同（label_cn 一致）

  关卡 2 — 视觉 ReID（图像相似度）
    若双方都存储了特征向量，计算 HSV 直方图的余弦相似度。
    GPS 精度有限（误差可达 3-5 m），仅靠空间距离可能误合并；
    加入视觉特征后，系统额外验证「长得像不像」：
      - 余弦相似度 > 0.92 → 强视觉匹配，空间条件放宽到 8 m
      - 余弦相似度 0.75~0.92 → 中等匹配，空间条件维持 5 m
      - 余弦相似度 < 0.75 → 视觉差异大，拒绝合并
    无特征向量时退化为纯空间判断。

融合得分
--------
  combined = α × spatial_score + β × visual_score
  α = 0.35, β = 0.65（视觉特征置信度更高）
  combined > MERGE_THRESHOLD → 合并到已有簇；否则创建新簇。
"""

import math
import uuid
from datetime import datetime
from typing import Optional

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import DiseaseRecord, DiseaseCluster

# ── 超参数 ────────────────────────────────────────────────────────────────────
SPATIAL_THRESHOLD_M  = 5.0   # 空间合并阈值（米）
SPATIAL_RELAXED_M    = 8.0   # 视觉强匹配时的宽松阈值
VISUAL_STRONG        = 0.92  # 强视觉匹配阈值
VISUAL_WEAK          = 0.75  # 最低视觉可接受阈值
MERGE_THRESHOLD      = 0.62  # 融合得分下限
ALPHA                = 0.35  # 空间分数权重
BETA                 = 0.65  # 视觉分数权重

# 模块级 PostGIS 可用性缓存，避免每次请求重复探测
_postgis_available: Optional[bool] = None


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine 公式计算两点间地面距离（米）。"""
    R = 6_371_000.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lng2 - lng1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _cosine_sim(v1: list, v2: list) -> float:
    """计算两个特征向量的余弦相似度，值域 [0, 1]。"""
    a, b = np.asarray(v1, dtype=np.float32), np.asarray(v2, dtype=np.float32)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom < 1e-8:
        return 0.0
    return float(np.clip(np.dot(a, b) / denom, 0.0, 1.0))


def _compute_severity(confidence: Optional[float], bbox: Optional[list]) -> int:
    """根据 ls-det 置信度与 bbox 像素面积自动初评病害严重等级（1-5 级）。

    评级逻辑：
      - 置信度权重 0.6：反映模型对病害存在的确信程度
      - 面积权重 0.4：反映病害的物理扩展程度（≥50000 px² 满分）
    """
    area_score = 0.0
    if bbox and len(bbox) >= 4:
        try:
            x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
            area_score = min(1.0, abs((x2 - x1) * (y2 - y1)) / 50_000.0)
        except (TypeError, ValueError):
            pass
    raw = 0.6 * (confidence or 0.0) + 0.4 * area_score
    return max(1, min(5, round(raw * 5)))


def _has_postgis(db: Session) -> bool:
    """探测 PostgreSQL + PostGIS 是否可用（结果缓存，仅首次查询）。"""
    global _postgis_available
    if _postgis_available is None:
        try:
            db.execute(text("SELECT postgis_version()"))
            _postgis_available = True
        except Exception:
            db.rollback()
            _postgis_available = False
    return _postgis_available


# ── 主入口 ────────────────────────────────────────────────────────────────────

def assign_cluster(
    lat: float,
    lng: float,
    label_cn: str,
    feature_vector: Optional[list],
    db: Session,
    confidence: Optional[float] = None,
    bbox: Optional[list] = None,
) -> str:
    """
    为新检测记录分配聚类 ID，同步维护 disease_clusters 主实体表。

    Args:
        confidence: ls-det 检测置信度，用于自动初评 severity。
        bbox:       检测框 [x1, y1, x2, y2]，与 confidence 共同决定 severity。

    Returns: UUID 字符串（已有簇 ID 或新建簇 ID）。
    """
    severity = _compute_severity(confidence, bbox)

    if not lat or not lng or (lat == 0.0 and lng == 0.0):
        cid = str(uuid.uuid4())
        _upsert_cluster(cid, label_cn, lat or 0.0, lng or 0.0, db,
                        is_new=True, severity=severity)
        return cid

    # ── 候选查询：PostGIS ST_DWithin（精确）或经纬度包围盒（降级）────────────
    if _has_postgis(db):
        rows = db.execute(text("""
            SELECT dr.cluster_id, dr.lat, dr.lng, dr.feature_vector
            FROM disease_records dr
            JOIN disease_clusters dc ON dr.cluster_id = dc.cluster_id
            WHERE dr.label_cn       = :label_cn
              AND dr.cluster_id     IS NOT NULL
              AND dr.deleted_at     IS NULL
              AND dc.location       IS NOT NULL
              AND dc.deleted_at     IS NULL
              AND ST_DWithin(
                    dc.location::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                    :radius
                  )
            ORDER BY dr.timestamp DESC
            LIMIT 30
        """), {"label_cn": label_cn, "lat": lat, "lng": lng,
               "radius": SPATIAL_RELAXED_M}).fetchall()
        candidates = [
            type("_C", (), {
                "cluster_id":     r.cluster_id,
                "lat":            r.lat,
                "lng":            r.lng,
                "feature_vector": r.feature_vector,
            })()
            for r in rows
        ]
    else:
        delta_lat = 10.0 / 111_111.0
        delta_lng = 10.0 / (111_111.0 * math.cos(math.radians(lat)))
        candidates = (
            db.query(DiseaseRecord)
            .filter(
                DiseaseRecord.label_cn == label_cn,
                DiseaseRecord.cluster_id.isnot(None),
                DiseaseRecord.deleted_at.is_(None),
                DiseaseRecord.lat.between(lat - delta_lat, lat + delta_lat),
                DiseaseRecord.lng.between(lng - delta_lng, lng + delta_lng),
            )
            .order_by(DiseaseRecord.timestamp.desc())
            .limit(30)
            .all()
        )

    best_score      = -1.0
    best_cluster_id = None

    for cand in candidates:
        dist_m = _haversine_m(lat, lng, cand.lat, cand.lng)

        has_visual = (feature_vector and cand.feature_vector
                      and len(feature_vector) > 0 and len(cand.feature_vector) > 0)

        if has_visual:
            visual_score  = _cosine_sim(feature_vector, cand.feature_vector)
            spatial_limit = SPATIAL_RELAXED_M if visual_score >= VISUAL_STRONG else SPATIAL_THRESHOLD_M
            if dist_m > spatial_limit or visual_score < VISUAL_WEAK:
                continue
            spatial_score = 1.0 - (dist_m / spatial_limit)
            combined      = ALPHA * spatial_score + BETA * visual_score
        else:
            if dist_m > SPATIAL_THRESHOLD_M:
                continue
            spatial_score = 1.0 - (dist_m / SPATIAL_THRESHOLD_M)
            combined      = spatial_score * 0.9

        if combined > best_score:
            best_score      = combined
            best_cluster_id = cand.cluster_id

    if best_cluster_id and best_score >= MERGE_THRESHOLD:
        _upsert_cluster(best_cluster_id, label_cn, lat, lng, db,
                        is_new=False, severity=severity)
        return best_cluster_id

    new_cid = str(uuid.uuid4())
    _upsert_cluster(new_cid, label_cn, lat, lng, db,
                    is_new=True, severity=severity)
    return new_cid


def _upsert_cluster(
    cluster_id: str,
    label_cn: str,
    lat: float,
    lng: float,
    db: Session,
    is_new: bool,
    severity: Optional[int] = None,
) -> None:
    """创建或更新 disease_clusters 实体行。

    新建簇时写入 severity（AI 初评）和 priority（= severity，待路段等级加权后覆盖）。
    合并到已有簇时不覆盖已有的 severity/priority，保留人工审核结果。
    """
    now = datetime.utcnow()
    existing = db.query(DiseaseCluster).filter(
        DiseaseCluster.cluster_id == cluster_id
    ).first()

    if existing is None:
        cluster = DiseaseCluster(
            cluster_id        = cluster_id,
            label_cn          = label_cn,
            canonical_lat     = lat,
            canonical_lng     = lng,
            status            = "pending",
            detection_count   = 1,
            severity          = severity,
            priority          = severity,  # 初始 priority = severity，可由路段等级覆盖
            first_detected_at = now,
            last_detected_at  = now,
        )
        db.add(cluster)
        # 若 PostGIS 可用，同步更新 location 几何列（触发 GIST 索引）
        if _postgis_available and lat and lng:
            db.flush()
            db.execute(text(
                "UPDATE disease_clusters "
                "SET location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) "
                "WHERE cluster_id = :cid"
            ), {"lng": lng, "lat": lat, "cid": cluster_id})
    else:
        # 合并：更新质心坐标（滑动均值）和计数
        n = existing.detection_count
        existing.canonical_lat   = (existing.canonical_lat * n + lat) / (n + 1)
        existing.canonical_lng   = (existing.canonical_lng * n + lng) / (n + 1)
        existing.detection_count = n + 1
        existing.last_detected_at = now
        # 更新 PostGIS 质心
        if _postgis_available:
            db.execute(text(
                "UPDATE disease_clusters "
                "SET location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) "
                "WHERE cluster_id = :cid"
            ), {"lng": existing.canonical_lng, "lat": existing.canonical_lat, "cid": cluster_id})
    # 不提交：由调用方（路由层）统一 commit
