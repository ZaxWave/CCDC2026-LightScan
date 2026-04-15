from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord, User
from app.schemas.disease import DailyCount, DiseaseRecordOut, StatsOut
from app.api.deps import get_current_user # 引入路由守卫

router = APIRouter(prefix="/api/v1/gis", tags=["gis"])


@router.get("/records", response_model=list[DiseaseRecordOut])
def get_records(
    limit: int = Query(500, ge=1, le=5000, description="返回条数上限"),
    offset: int = Query(0, ge=0, description="跳过条数"),
    db: Session = Depends(get_db),
):
    """获取含有坐标的病害记录（支持分页）- 全平台共享，无需登录也可看"""
    records = (
        db.query(DiseaseRecord)
        .filter(DiseaseRecord.lat != 0.0, DiseaseRecord.lng != 0.0)
        .order_by(DiseaseRecord.timestamp.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return records


@router.get("/my-records", response_model=list[DiseaseRecordOut])
def get_my_records(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) # 强制鉴权
):
    """获取当前用户上传的病害记录 - 个人维护专属"""
    return db.query(DiseaseRecord).filter(
        DiseaseRecord.creator_id == current_user.id
    ).order_by(DiseaseRecord.timestamp.desc()).all()


@router.delete("/records/{record_id}")
def delete_record(
    record_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) # 强制鉴权
):
    """删除病害记录 - 仅限本记录的创建者或管理员"""
    record = db.query(DiseaseRecord).filter(DiseaseRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if record.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权删除他人的记录")
    
    db.delete(record)
    db.commit()
    return {"message": "删除成功"}


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

    counts_by_date = {str(row.date): row.count for row in rows}

    daily = []
    for i in range(7):
        day = today - timedelta(days=6 - i)
        day_str = str(day)
        daily.append(DailyCount(date=day_str, count=counts_by_date.get(day_str, 0)))

    total = db.query(func.count(DiseaseRecord.id)).scalar() or 0

    return StatsOut(daily=daily, total=total)