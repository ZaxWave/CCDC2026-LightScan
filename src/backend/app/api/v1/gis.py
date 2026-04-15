from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord
from app.schemas.disease import DailyCount, DiseaseRecordOut, StatsOut

router = APIRouter(prefix="/api/v1/gis", tags=["gis"])


@router.get("/records", response_model=list[DiseaseRecordOut])
def get_records(
    limit: int = Query(500, ge=1, le=5000, description="返回条数上限"),
    offset: int = Query(0, ge=0, description="跳过条数"),
    db: Session = Depends(get_db),
):
    """获取含有坐标的病害记录（支持分页）"""
    records = (
        db.query(DiseaseRecord)
        .filter(DiseaseRecord.lat != 0.0, DiseaseRecord.lng != 0.0)
        .order_by(DiseaseRecord.timestamp.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return records


@router.get("/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    """返回近 7 天每日检出数量及总计"""
    today = datetime.now(tz=timezone.utc).date()
    seven_days_ago = today - timedelta(days=6)

    rows = (
        db.query(
            func.date(DiseaseRecord.timestamp).label("date"),
            func.count(DiseaseRecord.id).label("count"),
        )
        .filter(func.date(DiseaseRecord.timestamp) >= seven_days_ago)
        .group_by(func.date(DiseaseRecord.timestamp))
        .order_by(func.date(DiseaseRecord.timestamp))
        .all()
    )

    # 将查询结果转为字典，便于按日期查找
    counts_by_date = {str(row.date): row.count for row in rows}

    # 补全缺失的日期（填 0），保证始终返回 7 天
    daily = []
    for i in range(7):
        day = today - timedelta(days=6 - i)
        day_str = str(day)
        daily.append(DailyCount(date=day_str, count=counts_by_date.get(day_str, 0)))

    total = db.query(func.count(DiseaseRecord.id)).scalar() or 0

    return StatsOut(daily=daily, total=total)
