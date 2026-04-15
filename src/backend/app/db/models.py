from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB 
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default="worker")  # 角色：'admin' 或 'worker'
    is_active = Column(Boolean, default=True)

    # 建立一对多关联：一个用户对应多条检测记录
    records = relationship("DiseaseRecord", back_populates="creator")

class DiseaseRecord(Base):
    __tablename__ = "disease_records"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    lat = Column(Float, index=True)
    lng = Column(Float, index=True)
    label = Column(String, index=True)
    label_cn = Column(String)
    confidence = Column(Float)
    color_hex = Column(String)
    bbox = Column(JSONB)

    # 新增外键和反向关联
    creator_id = Column(Integer, ForeignKey("users.id"), index=True)
    creator = relationship("User", back_populates="records")