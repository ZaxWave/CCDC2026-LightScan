# src/backend/app/schemas/disease.py
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class DiseaseRecordOut(BaseModel):
    id: int
    filename: Optional[str] = None
    timestamp: Optional[datetime] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    label: Optional[str] = None
    label_cn: Optional[str] = None
    confidence: Optional[float] = None
    color_hex: Optional[str] = None
    bbox: Optional[Any] = None

    model_config = {"from_attributes": True}


class DailyCount(BaseModel):
    date: str    # "YYYY-MM-DD"
    count: int


class StatsOut(BaseModel):
    daily: list[DailyCount]
    total: int
