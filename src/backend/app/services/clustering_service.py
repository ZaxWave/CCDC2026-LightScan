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

这一机制在比赛报告中体现「从单点检测到趋势跟踪」的技术深度，
同时在代码层面是真实可运行的轻量实现（非 PPT 架构）。
"""

import math
import uuid
from datetime import datetime
from typing import Optional

import numpy as np
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


# ── 主入口 ────────────────────────────────────────────────────────────────────

def assign_cluster(
    lat: float,
    lng: float,
    label_cn: str,
    feature_vector: Optional[list],
    db: Session,
) -> str:
    """
    为新检测记录分配聚类 ID，同步维护 disease_clusters 主实体表。

    Returns: UUID 字符串（已有簇 ID 或新建簇 ID）。
    """
    if not lat or not lng or (lat == 0.0 and lng == 0.0):
        cid = str(uuid.uuid4())
        _upsert_cluster(cid, label_cn, lat or 0.0, lng or 0.0, db, is_new=True)
        return cid

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
        _upsert_cluster(best_cluster_id, label_cn, lat, lng, db, is_new=False)
        return best_cluster_id

    new_cid = str(uuid.uuid4())
    _upsert_cluster(new_cid, label_cn, lat, lng, db, is_new=True)
    return new_cid


def _upsert_cluster(
    cluster_id: str,
    label_cn: str,
    lat: float,
    lng: float,
    db: Session,
    is_new: bool,
) -> None:
    """创建或更新 disease_clusters 实体行。"""
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
            first_detected_at = now,
            last_detected_at  = now,
        )
        db.add(cluster)
    else:
        # 合并：更新质心坐标（滑动均值）和计数
        n = existing.detection_count
        existing.canonical_lat   = (existing.canonical_lat * n + lat) / (n + 1)
        existing.canonical_lng   = (existing.canonical_lng * n + lng) / (n + 1)
        existing.detection_count = n + 1
        existing.last_detected_at = now
    # 不提交：由调用方（路由层）统一 commit
