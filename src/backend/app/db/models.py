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

    records  = relationship("DiseaseRecord",  back_populates="creator")
    clusters = relationship("DiseaseCluster", back_populates="worker")


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
    first_detected_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_detected_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    repaired_at       = Column(DateTime, nullable=True)
    repaired_image_b64 = Column(Text, nullable=True)

    worker  = relationship("User",          back_populates="clusters")
    records = relationship("DiseaseRecord", back_populates="cluster")


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

    # 冗余字段（向后兼容旧接口，以 cluster 为准）
    status             = Column(String, default="pending", nullable=False, server_default="pending")
    worker_name        = Column(String, nullable=True)
    repaired_image_b64 = Column(Text, nullable=True)
    repaired_at        = Column(DateTime, nullable=True)
    dispatch_info      = Column(JSONB, nullable=True)  # AI 生成的工单内容

    creator = relationship("User",           back_populates="records")
    cluster = relationship("DiseaseCluster", back_populates="records")