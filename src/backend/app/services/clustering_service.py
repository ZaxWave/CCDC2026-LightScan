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
from typing import Optional

import numpy as np
from sqlalchemy.orm import Session

from app.db.models import DiseaseRecord

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
    为新检测记录分配聚类 ID。

    Parameters
    ----------
    lat, lng        : 记录的 GPS 坐标
    label_cn        : 病害中文类型（必须与候选记录一致才考虑合并）
    feature_vector  : 32 维 HSV 直方图特征（可为 None）
    db              : SQLAlchemy Session

    Returns
    -------
    str : UUID 字符串，若与已有簇合并则返回该簇 ID，否则返回新 UUID。
    """
    # 无坐标信息 → 无法聚类，直接新建
    if not lat or not lng or (lat == 0.0 and lng == 0.0):
        return str(uuid.uuid4())

    # 粗筛：以 10 m 为粗框查找同类型已有聚类记录（覆盖精确阈值的 2 倍）
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

        # ── 关卡 1：空间距离检查 ──────────────────────────────
        has_visual = (feature_vector and cand.feature_vector
                      and len(feature_vector) > 0 and len(cand.feature_vector) > 0)

        if has_visual:
            visual_score = _cosine_sim(feature_vector, cand.feature_vector)
            # 视觉强匹配时允许更宽松的空间范围
            spatial_limit = SPATIAL_RELAXED_M if visual_score >= VISUAL_STRONG else SPATIAL_THRESHOLD_M
            if dist_m > spatial_limit:
                continue
            if visual_score < VISUAL_WEAK:
                continue  # 视觉差异过大，拒绝合并

            # ── 关卡 2：融合评分 ─────────────────────────────
            spatial_score = 1.0 - (dist_m / spatial_limit)
            combined = ALPHA * spatial_score + BETA * visual_score
        else:
            # 无特征向量：纯空间判断
            if dist_m > SPATIAL_THRESHOLD_M:
                continue
            spatial_score = 1.0 - (dist_m / SPATIAL_THRESHOLD_M)
            visual_score  = 0.0
            combined = spatial_score * 0.9   # 纯空间置信度打九折

        if combined > best_score:
            best_score      = combined
            best_cluster_id = cand.cluster_id

    if best_cluster_id and best_score >= MERGE_THRESHOLD:
        return best_cluster_id

    # 未找到满足条件的候选 → 创建新簇
    return str(uuid.uuid4())
