import math
import base64
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord, DiseaseCluster, User, AuditLog, DiseaseMedia
from app.schemas.disease import DailyCount, DiseaseRecordOut, StatsOut
from app.api.deps import get_current_user

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
async def update_record_status(
    record_id: int,
    status: str = Form(...),
    worker_name: Optional[str] = Form(None),
    repaired_image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新工单流转状态；status=repaired 时可附上修后照片。"""
    _valid = {"pending", "processing", "repaired"}
    if status not in _valid:
        raise HTTPException(status_code=400, detail=f"无效状态值，可选：{_valid}")

    record = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权修改他人的记录")

    prev_status = record.status
    record.status = status
    if worker_name is not None:
        record.worker_name = worker_name

    repaired_b64 = None
    if status == "repaired":
        record.repaired_at = datetime.utcnow()
        if repaired_image:
            img_bytes = await repaired_image.read()
            mime = repaired_image.content_type or "image/jpeg"
            repaired_b64 = f"data:{mime};base64," + base64.b64encode(img_bytes).decode()
            record.repaired_image_b64 = repaired_b64
            # 大字段分离：同步写入 disease_media 表
            db.add(DiseaseMedia(
                cluster_id=record.cluster_id,
                record_id=record.id,
                media_type="repaired",
                b64_data=repaired_b64,
            ))

    # 审计日志：记录 record 状态流转
    db.add(AuditLog(
        entity_type="record",
        entity_id=str(record.id),
        from_status=prev_status,
        to_status=status,
        operator_id=current_user.id,
    ))

    # 同步更新 disease_clusters 主实体
    if record.cluster_id:
        cluster = db.query(DiseaseCluster).filter(
            DiseaseCluster.cluster_id == record.cluster_id
        ).first()
        if cluster:
            prev_cluster_status = cluster.status
            cluster.status = status
            if worker_name:
                cluster.worker_id = current_user.id
            if status == "repaired":
                cluster.repaired_at = record.repaired_at
                if repaired_b64:
                    cluster.repaired_image_b64 = repaired_b64
            # 审计日志：记录 cluster 状态流转
            if prev_cluster_status != status:
                db.add(AuditLog(
                    entity_type="cluster",
                    entity_id=cluster.cluster_id,
                    from_status=prev_cluster_status,
                    to_status=status,
                    operator_id=current_user.id,
                ))

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

    # 若 cluster 下所有记录均已软删除，同步软删除 cluster，防止历史档案丢失
    if record.cluster_id:
        active_siblings = db.query(DiseaseRecord).filter(
            DiseaseRecord.cluster_id == record.cluster_id,
            DiseaseRecord.id != record.id,
            DiseaseRecord.deleted_at.is_(None),
        ).count()
        if active_siblings == 0:
            cluster = db.query(DiseaseCluster).filter(
                DiseaseCluster.cluster_id == record.cluster_id
            ).first()
            if cluster and cluster.deleted_at is None:
                cluster.deleted_at = record.deleted_at

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


@router.delete("/records/{record_id}/permanent")
def permanent_delete_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """从回收站彻底删除记录（不可恢复）"""
    record = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.creator_id == current_user.id,
        DiseaseRecord.deleted_at != None,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    db.delete(record)
    db.commit()
    return {"message": "已彻底删除"}


@router.post("/records/batch-permanent-delete")
def batch_permanent_delete_records(
    body: BatchDeleteBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """批量彻底删除回收站记录"""
    if not body.ids:
        raise HTTPException(status_code=400, detail="请提供要删除的记录 ID")
    records = (
        db.query(DiseaseRecord)
        .filter(
            DiseaseRecord.id.in_(body.ids),
            DiseaseRecord.creator_id == current_user.id,
            DiseaseRecord.deleted_at != None,
        )
        .all()
    )
    for r in records:
        db.delete(r)
    db.commit()
    return {"message": f"已彻底删除：{len(records)} 条"}


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
            "id":            r.id,
            "timestamp":     r.timestamp.replace(tzinfo=timezone.utc).isoformat(),
            "confidence":    round(r.confidence, 4) if r.confidence is not None else None,
            "bbox_area":     bbox_area,
            "filename":      r.filename,
            "status":        r.status,
            "thumbnail_b64": r.thumbnail_b64 or None,
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


@router.get("/clusters/{record_id}/fusion")
def get_cluster_fusion(record_id: int, db: Session = Depends(get_db)):
    """
    多源融合全景分析。

    返回同一聚类内所有检测记录的图像证据、来源构成和融合置信度。

    融合置信度公式：P_fused = 1 − ∏(1 − Pᵢ)
    含义：多个独立观测中至少一次正确识别的概率，等效于多低精度源代偿专业设备。
    """
    ref = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not ref:
        raise HTTPException(status_code=404, detail="记录不存在")

    if ref.cluster_id:
        records = (
            db.query(DiseaseRecord)
            .filter(
                DiseaseRecord.cluster_id == ref.cluster_id,
                DiseaseRecord.deleted_at == None,
            )
            .order_by(DiseaseRecord.timestamp.asc())
            .all()
        )
    else:
        records = [ref]

    # 质心均值
    valid_lats = [r.lat for r in records if r.lat]
    valid_lngs = [r.lng for r in records if r.lng]
    center_lat = sum(valid_lats) / len(valid_lats) if valid_lats else (ref.lat or 0)
    center_lng = sum(valid_lngs) / len(valid_lngs) if valid_lngs else (ref.lng or 0)

    def _bearing(lat1, lng1, lat2, lng2):
        """返回从 (lat1,lng1) 指向 (lat2,lng2) 的方位角（0°=北，顺时针）。"""
        dL = math.radians(lng2 - lng1)
        r1, r2 = math.radians(lat1), math.radians(lat2)
        x = math.sin(dL) * math.cos(r2)
        y = math.cos(r1) * math.sin(r2) - math.sin(r1) * math.cos(r2) * math.cos(dL)
        return (math.degrees(math.atan2(x, y)) + 360) % 360

    def _dist_m(la1, lo1, la2, lo2):
        R = 6_371_000.0
        p1, p2 = math.radians(la1), math.radians(la2)
        dp = math.radians(la2 - la1)
        dl = math.radians(lo2 - lo1)
        a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    # 按 source_type 分组
    source_groups: dict = {}
    for r in records:
        src = r.source_type or "unknown"
        source_groups.setdefault(src, []).append(r)

    # 每条记录的证据对象（限制缩略图大小：已存 thumbnail_b64 直接用）
    n = len(records)
    evidence = []
    for i, r in enumerate(records):
        brg = _bearing(center_lat, center_lng, r.lat or center_lat, r.lng or center_lng) \
              if (r.lat and r.lng and (abs(r.lat - center_lat) > 1e-7 or abs(r.lng - center_lng) > 1e-7)) \
              else (i * 360 / max(n, 1))
        evidence.append({
            "id":            r.id,
            "source_type":   r.source_type or "unknown",
            "confidence":    round(r.confidence, 4) if r.confidence is not None else None,
            "timestamp":     r.timestamp.replace(tzinfo=timezone.utc).isoformat() if r.timestamp else None,
            "thumbnail_b64": r.thumbnail_b64,
            "bearing_deg":   round(brg, 1),
            "lat":           r.lat,
            "lng":           r.lng,
        })

    # 融合置信度：P = 1 − ∏(1 − Pᵢ)
    confs = [r.confidence for r in records if r.confidence is not None]
    if confs:
        p_complement = 1.0
        for c in confs:
            p_complement *= (1.0 - c)
        p_fused = 1.0 - p_complement
    else:
        p_fused = 0.0
    max_individual = max(confs) if confs else 0.0

    # GPS 散布半径（质心到最远记录的距离）
    scatter_m = 0.0
    if len(valid_lats) > 1:
        scatter_m = max(
            _dist_m(center_lat, center_lng, la, lo)
            for la, lo in zip(valid_lats, valid_lngs)
        )

    source_stats = {
        src: {
            "count":    len(rs),
            "max_conf": round(max((r.confidence for r in rs if r.confidence is not None), default=0.0), 4),
            "avg_conf": round(
                sum(r.confidence for r in rs if r.confidence is not None) /
                max(sum(1 for r in rs if r.confidence is not None), 1),
                4,
            ),
        }
        for src, rs in source_groups.items()
    }

    return {
        "label_cn":             ref.label_cn,
        "label":                ref.label,
        "color_hex":            ref.color_hex,
        "cluster_id":           ref.cluster_id,
        "total":                n,
        "evidence":             evidence,
        "source_stats":         source_stats,
        "fused_confidence":     round(p_fused, 4),
        "max_individual_conf":  round(max_individual, 4),
        "boost":                round(max(0.0, p_fused - max_individual), 4),
        "scatter_radius_m":     round(scatter_m, 1),
        "center_lat":           center_lat,
        "center_lng":           center_lng,
    }


@router.get("/source-stats")
def get_source_stats(db: Session = Depends(get_db)):
    """返回各数据来源的记录数量，用于大屏来源分布图。"""
    SOURCE_LABEL = {
        "bus_dashcam":    "公交记录仪",
        "street_camera":  "路侧监控",
        "drone":          "无人机",
        "manual":         "人工巡检",
    }
    rows = (
        db.query(DiseaseRecord.source_type, func.count(DiseaseRecord.id))
        .filter(DiseaseRecord.deleted_at == None)
        .group_by(DiseaseRecord.source_type)
        .all()
    )
    result = []
    for src, cnt in rows:
        key = src or "manual"
        result.append({"source_type": key, "label": SOURCE_LABEL.get(key, key), "count": cnt})
    return result


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
        .filter(
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

    total = db.query(func.count(DiseaseRecord.id)).filter(DiseaseRecord.deleted_at == None).scalar() or 0

    return StatsOut(daily=daily, total=total)