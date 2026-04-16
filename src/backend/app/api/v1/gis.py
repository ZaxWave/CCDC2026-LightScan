from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord, User
from app.schemas.disease import DailyCount, DiseaseRecordOut, StatsOut
from app.api.deps import get_current_user # 引入路由守卫

router = APIRouter(prefix="/api/v1/gis", tags=["gis"])

class BatchDeleteBody(BaseModel):
    ids: List[int]


@router.get("/records", response_model=list[DiseaseRecordOut])
def get_records(
    limit: int = Query(500, ge=1, le=5000, description="返回条数上限"),
    offset: int = Query(0, ge=0, description="跳过条数"),
    db: Session = Depends(get_db),
):
    """获取含有坐标的病害记录（支持分页）- 全平台共享，无需登录也可看"""
    records = (
        db.query(DiseaseRecord)
        .filter(
            DiseaseRecord.lat != 0.0,
            DiseaseRecord.lng != 0.0,
            DiseaseRecord.deleted_at == None,
        )
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
    """获取当前用户上传的病害记录 - 个人维护专属（不含已软删除）"""
    return db.query(DiseaseRecord).filter(
        DiseaseRecord.creator_id == current_user.id,
        DiseaseRecord.deleted_at == None,
    ).order_by(DiseaseRecord.timestamp.desc()).all()


@router.delete("/records/{record_id}")
def delete_record(
    record_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) # 强制鉴权
):
    """软删除病害记录 - 移入回收站，仅限本记录的创建者或管理员"""
    record = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")

    if record.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权删除他人的记录")

    record.deleted_at = datetime.now(tz=timezone.utc)
    db.commit()
    return {"message": "已移入回收站"}


@router.post("/records/batch-delete")
def batch_delete_records(
    body: BatchDeleteBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """批量软删除 - 仅操作属于当前用户的记录"""
    if not body.ids:
        raise HTTPException(status_code=400, detail="请提供要删除的记录 ID")
    now = datetime.now(tz=timezone.utc)
    updated = (
        db.query(DiseaseRecord)
        .filter(
            DiseaseRecord.id.in_(body.ids),
            DiseaseRecord.creator_id == current_user.id,
            DiseaseRecord.deleted_at == None,
        )
        .all()
    )
    for r in updated:
        r.deleted_at = now
    db.commit()
    return {"message": f"已移入回收站：{len(updated)} 条"}


@router.get("/deleted-records", response_model=list[DiseaseRecordOut])
def get_deleted_records(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取当前用户的回收站记录（软删除后 7 天内）"""
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=7)
    return (
        db.query(DiseaseRecord)
        .filter(
            DiseaseRecord.creator_id == current_user.id,
            DiseaseRecord.deleted_at != None,
            DiseaseRecord.deleted_at >= cutoff,
        )
        .order_by(DiseaseRecord.deleted_at.desc())
        .all()
    )


@router.post("/records/{record_id}/restore")
def restore_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """从回收站恢复记录"""
    record = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.creator_id == current_user.id,
        DiseaseRecord.deleted_at != None,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在或已彻底删除")
    record.deleted_at = None
    db.commit()
    return {"message": "已恢复"}


@router.get("/my-stats", response_model=StatsOut)
def get_my_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """返回当前用户近 7 天每日检出数量及个人总计"""
    today = datetime.now(tz=timezone.utc).date()
    seven_days_ago = today - timedelta(days=6)

    rows = (
        db.query(
            func.date(DiseaseRecord.timestamp).label("date"),
            func.count(DiseaseRecord.id).label("count"),
        )
        .filter(
            DiseaseRecord.creator_id == current_user.id,
            func.date(DiseaseRecord.timestamp) >= seven_days_ago,
            DiseaseRecord.deleted_at == None,
        )
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

    total = (
        db.query(func.count(DiseaseRecord.id))
        .filter(
            DiseaseRecord.creator_id == current_user.id,
            DiseaseRecord.deleted_at == None,
        )
        .scalar()
        or 0
    )
    return StatsOut(daily=daily, total=total)


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