# src/backend/app/schemas/disease.py
from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, field_serializer


def _to_utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


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
    status: Optional[str] = "pending"
    worker_name: Optional[str] = None
    deleted_at: Optional[datetime] = None
    source_type: Optional[str] = None
    device_id: Optional[str] = None
    repaired_image_b64: Optional[str] = None
    repaired_at: Optional[datetime] = None
    cluster_id: Optional[str] = None
    dispatch_info: Optional[Any] = None
    captured_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

    @field_serializer('timestamp', 'deleted_at', 'repaired_at', 'captured_at', when_used='json')
    def serialize_dt(self, v: datetime | None) -> str | None:
        return _to_utc_iso(v)


class DailyCount(BaseModel):
    date: str    # "YYYY-MM-DD"
    count: int


class StatsOut(BaseModel):
    daily: list[DailyCount]
    total: int
