import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord
from app.api.deps import get_current_user
from app.db.models import User
from app.services.ai_report_service import generate_area_report, generate_cluster_advice

router = APIRouter(prefix="/api/v1/ai", tags=["ai-report"])


class ReportOut(BaseModel):
    report: str
    generated_at: str
    record_count: int


class AdviceOut(BaseModel):
    advice: str
    label_cn: str
    trend: str
    generated_at: str


@router.post("/report", response_model=ReportOut)
async def ai_area_report(
    days: int = Query(7, ge=1, le=90, description="统计最近 N 天"),
    area: str = Query("全辖区", description="区域标签，用于报告标题"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """调用 DeepSeek 生成辖区巡检周报与养护建议。"""
    since = datetime.now(tz=timezone.utc) - timedelta(days=days)
    records = (
        db.query(DiseaseRecord)
        .filter(
            DiseaseRecord.timestamp >= since,
            DiseaseRecord.deleted_at == None,
        )
        .all()
    )
    if not records:
        raise HTTPException(status_code=404, detail=f"最近 {days} 天内暂无病害记录")

    try:
        report_text = await generate_area_report(records, area=area, days=days)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DeepSeek 调用失败：{e}")

    return ReportOut(
        report=report_text,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
        record_count=len(records),
    )


@router.post("/cluster/{record_id}/advice", response_model=AdviceOut)
async def ai_cluster_advice(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """针对指定病害点的时序数据，调用 DeepSeek 生成单点养护处置建议。"""
    ref = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not ref:
        raise HTTPException(status_code=404, detail="记录不存在")

    three_months_ago = datetime.utcnow() - timedelta(days=90)

    if ref.cluster_id:
        cluster_records = (
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
        if not ref.lat or not ref.lng:
            raise HTTPException(status_code=422, detail="该记录缺少坐标信息")
        delta_lat = 10.0 / 111111.0
        delta_lng = 10.0 / (111111.0 * math.cos(math.radians(ref.lat)))
        cluster_records = (
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

    timeline = [
        {
            "timestamp": r.timestamp.replace(tzinfo=timezone.utc).isoformat(),
            "confidence": round(r.confidence, 4) if r.confidence else None,
            "status": r.status,
        }
        for r in cluster_records
    ]

    conf_vals = [t["confidence"] for t in timeline if t["confidence"] is not None]
    if len(conf_vals) >= 2:
        delta = conf_vals[-1] - conf_vals[0]
        trend = "deteriorating" if delta > 0.05 else ("improving" if delta < -0.05 else "stable")
    else:
        trend = "stable"

    try:
        advice_text = await generate_cluster_advice(ref.label_cn or ref.label, timeline)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DeepSeek 调用失败：{e}")

    return AdviceOut(
        advice=advice_text,
        label_cn=ref.label_cn or ref.label,
        trend=trend,
        generated_at=datetime.now(tz=timezone.utc).isoformat(),
    )
