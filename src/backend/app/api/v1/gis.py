import math
from datetime import datetime, timedelta, timezone
from typing import List, Optional

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

class StatusUpdateBody(BaseModel):
    status: str
    worker_name: Optional[str] = None


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


@router.patch("/records/{record_id}/status", response_model=DiseaseRecordOut)
def update_record_status(
    record_id: int,
    body: StatusUpdateBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新工单流转状态（待修/维修中/已修）- 仅限记录创建者或管理员"""
    _valid = {"pending", "processing", "repaired"}
    if body.status not in _valid:
        raise HTTPException(status_code=400, detail=f"无效状态值，可选：{_valid}")

    record = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权修改他人的记录")

    record.status = body.status
    if body.worker_name is not None:
        record.worker_name = body.worker_name
    db.commit()
    db.refresh(record)
    return record


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


@router.get("/clusters/{record_id}/timeline")
def get_cluster_timeline(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    演变时间轴：以给定记录为参照，查找 10m 半径内、相同病害类型、近 3 个月的所有拍摄记录，
    按时间升序返回置信度与检测框面积，用于前端绘制恶化趋势折线图。
    """
    ref = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not ref:
        raise HTTPException(status_code=404, detail="记录不存在")
    if not ref.lat or not ref.lng:
        raise HTTPException(status_code=422, detail="该记录缺少坐标信息")

    three_months_ago = datetime.utcnow() - timedelta(days=90)

    # 10 米对应的经纬度容差（赤道附近 1° ≈ 111111m）
    delta_lat = 10.0 / 111111.0
    delta_lng = 10.0 / (111111.0 * math.cos(math.radians(ref.lat)))

    # 优先按 cluster_id 查（ReID 聚类后精度更高）；
    # 无 cluster_id 的旧数据回退到空间查询。
    if ref.cluster_id:
        records = (
            db.query(DiseaseRecord)
            .filter(
                DiseaseRecord.cluster_id == ref.cluster_id,
                DiseaseRecord.timestamp >= three_months_ago,
                DiseaseRecord.deleted_at == None,
            )
            .order_by(DiseaseRecord.timestamp.asc())
            .all()
        )
    else:
        records = (
            db.query(DiseaseRecord)
            .filter(
                DiseaseRecord.label_cn == ref.label_cn,
                DiseaseRecord.lat.between(ref.lat - delta_lat, ref.lat + delta_lat),
                DiseaseRecord.lng.between(ref.lng - delta_lng, ref.lng + delta_lng),
                DiseaseRecord.timestamp >= three_months_ago,
                DiseaseRecord.deleted_at == None,
            )
            .order_by(DiseaseRecord.timestamp.asc())
            .all()
        )

    timeline = []
    for r in records:
        bbox_area = None
        if r.bbox and isinstance(r.bbox, list) and len(r.bbox) >= 4:
            try:
                x1, y1, x2, y2 = (float(v) for v in r.bbox[:4])
                bbox_area = round(abs((x2 - x1) * (y2 - y1)))
            except (TypeError, ValueError):
                pass

        timeline.append({
            "id":         r.id,
            "timestamp":  r.timestamp.isoformat(),
            "confidence": round(r.confidence, 4) if r.confidence is not None else None,
            "bbox_area":  bbox_area,
            "filename":   r.filename,
            "status":     r.status,
        })

    # 简单趋势判断：末尾 vs 开头置信度差值
    conf_vals = [t["confidence"] for t in timeline if t["confidence"] is not None]
    if len(conf_vals) >= 2:
        delta = conf_vals[-1] - conf_vals[0]
        trend = "deteriorating" if delta > 0.05 else ("improving" if delta < -0.05 else "stable")
    else:
        trend = "stable"

    return {
        "label":     ref.label,
        "label_cn":  ref.label_cn,
        "color_hex": ref.color_hex,
        "lat":       ref.lat,
        "lng":       ref.lng,
        "total":     len(timeline),
        "trend":     trend,
        "timeline":  timeline,
    }


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