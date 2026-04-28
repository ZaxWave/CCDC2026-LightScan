from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class User(Base):
    __tablename__ = "users"

    id           = Column(Integer, primary_key=True, index=True)
    username     = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role         = Column(String, default="worker")
    is_active    = Column(Boolean, default=True)
    created_at   = Column(DateTime, default=datetime.utcnow, nullable=True)
    nickname     = Column(String, nullable=True)
    unit         = Column(String, nullable=True)
    source_type  = Column(String, nullable=True, default="manual")
    device_id    = Column(String, nullable=True)

    records   = relationship("DiseaseRecord",  back_populates="creator")
    clusters  = relationship("DiseaseCluster", back_populates="worker")
    audit_logs = relationship("AuditLog",      back_populates="operator")


class DiseaseCluster(Base):
    """病害聚类主实体表：每行代表一个独立的物理病害点，聚合多次观测记录。"""
    __tablename__ = "disease_clusters"

    cluster_id        = Column(String, primary_key=True, index=True)   # UUID
    worker_id         = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    label_cn          = Column(String, nullable=False)
    canonical_lat     = Column(Float,  nullable=False)
    canonical_lng     = Column(Float,  nullable=False)
    status            = Column(String, default="pending", nullable=False, server_default="pending")
    detection_count   = Column(Integer, default=1, nullable=False, server_default="1")
    # AI 自动初评字段
    severity          = Column(Integer, nullable=True)  # 1-5，由 ls-det 置信度+bbox 面积估算
    priority          = Column(Integer, nullable=True)  # 1-5，综合路段等级与 severity 生成
    first_detected_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_detected_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    repaired_at       = Column(DateTime, nullable=True)
    repaired_image_b64 = Column(Text, nullable=True)
    deleted_at        = Column(DateTime, nullable=True, default=None)  # 软删除时间戳

    worker  = relationship("User",          back_populates="clusters")
    records = relationship("DiseaseRecord", back_populates="cluster")
    media   = relationship("DiseaseMedia",  back_populates="cluster")


class DiseaseRecord(Base):
    """病害检测记录表：每行为一次采集快照，通过 cluster_id 归属到病害聚类实体。"""
    __tablename__ = "disease_records"

    id         = Column(Integer, primary_key=True, index=True)
    cluster_id = Column(String, ForeignKey("disease_clusters.cluster_id"), nullable=True, index=True)
    creator_id = Column(Integer, ForeignKey("users.id"), index=True)
    filename   = Column(String, index=True)
    timestamp  = Column(DateTime, default=datetime.utcnow, index=True)
    lat        = Column(Float, index=True)
    lng        = Column(Float, index=True)
    label      = Column(String, index=True)
    label_cn   = Column(String)
    confidence = Column(Float)
    color_hex  = Column(String)
    bbox       = Column(JSONB)
    feature_vector = Column(JSONB, nullable=True)
    source_type    = Column(String, nullable=True)
    device_id      = Column(String, nullable=True)
    deleted_at     = Column(DateTime, nullable=True, default=None)
    content_hash   = Column(String(64), nullable=True, index=True)  # SHA-256 图片内容指纹，用于去重

    # 冗余字段（向后兼容旧接口，以 cluster 为准）
    status             = Column(String, default="pending", nullable=False, server_default="pending")
    worker_name        = Column(String, nullable=True)
    repaired_image_b64 = Column(Text, nullable=True)
    repaired_at        = Column(DateTime, nullable=True)
    dispatch_info      = Column(JSONB, nullable=True)
    thumbnail_b64      = Column(Text, nullable=True)

    creator = relationship("User",           back_populates="records")
    cluster = relationship("DiseaseCluster", back_populates="records")
    media   = relationship("DiseaseMedia",   back_populates="record")


class AuditLog(Base):
    """状态变更审计日志：记录 cluster/record 每次状态流转（谁、何时、从何状态变为何状态）。"""
    __tablename__ = "audit_log"

    id          = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String, nullable=False)          # "cluster" | "record"
    entity_id   = Column(String, nullable=False, index=True)
    from_status = Column(String, nullable=True)
    to_status   = Column(String, nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_at  = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    note        = Column(String, nullable=True)

    operator = relationship("User", back_populates="audit_logs")


class DiseaseMedia(Base):
    """大字段分离表：图片路径/Base64 独立存储，防止主表体积膨胀拖慢索引扫描。
    优先使用 storage_url（OSS/MinIO），b64_data 作为无外部存储时的兜底方案。"""
    __tablename__ = "disease_media"

    id          = Column(Integer, primary_key=True, index=True)
    cluster_id  = Column(String, ForeignKey("disease_clusters.cluster_id"), nullable=True, index=True)
    record_id   = Column(Integer, ForeignKey("disease_records.id"), nullable=True, index=True)
    media_type  = Column(String, nullable=False)   # "thumbnail" | "repaired"
    storage_url = Column(String, nullable=True)    # OSS/MinIO URL（优先使用）
    b64_data    = Column(Text, nullable=True)      # 兜底内嵌 Base64
    created_at  = Column(DateTime, default=datetime.utcnow)

    cluster = relationship("DiseaseCluster", back_populates="media")
    record  = relationship("DiseaseRecord",  back_populates="media")
