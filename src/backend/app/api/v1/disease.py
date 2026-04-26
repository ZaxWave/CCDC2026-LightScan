"""
/api/v1/disease — 智能养护工单派发

  POST /dispatch/{record_id}     AI 生成维修方案并将记录置为 processing
  GET  /orders                   列出已派发工单（供移动端拉取）
  PATCH /orders/{record_id}/status  巡检员接单 / 标记完工
"""
import os
import json
import requests as req
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord, DiseaseCluster, AuditLog
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/v1/disease", tags=["Disease Orders"])

# ── DeepSeek 派发提示词 ─────────────────────────────────────────────────────────
_DISPATCH_PROMPT = """\
你是路政养护工程专家。根据以下道路病害检测记录，生成标准化维修工单。

病害信息：
- 类型：{label_cn}（代码 {label}）
- 置信度：{confidence:.0%}
- 位置：{lat:.5f}°N，{lng:.5f}°E
- 检测时间：{timestamp}

请仅输出以下 JSON，不含代码块标记：
{{
  "urgency": "高危",
  "repair_method": "热拌沥青混合料填补法：清除松散料 → 切割整形 → 涂刷粘层油 → 填料压实",
  "material_estimate": [
    {{"name": "热拌沥青混合料", "quantity": "0.05 m³", "unit_cost": "800 元/m³"}},
    {{"name": "乳化沥青粘层油", "quantity": "0.3 kg",  "unit_cost": "4 元/kg"}}
  ],
  "estimated_hours": 1.5,
  "safety_notes": "封闭单侧车道，设置锥形引导，夜间须开警示灯",
  "priority_reason": "坑槽深度超标，行车安全隐患高，建议 24h 内处理"
}}
"""


class OrderStatusUpdate(BaseModel):
    status: str  # processing | repaired


class DispatchOut(BaseModel):
    record_id: int
    label_cn: str
    urgency: str
    repair_method: str
    material_estimate: list
    estimated_hours: float
    safety_notes: str
    priority_reason: str
    dispatched_at: str


# ── 派发工单 ──────────────────────────────────────────────────────────────────
@router.post("/dispatch/{record_id}", response_model=DispatchOut)
def dispatch_order(
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """调用 DeepSeek 生成维修工单，写入 dispatch_info，状态置为 processing。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY 未配置")

    record = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")

    prompt = _DISPATCH_PROMPT.format(
        label_cn=record.label_cn or "未知",
        label=record.label or "—",
        confidence=record.confidence or 0.0,
        lat=record.lat or 0.0,
        lng=record.lng or 0.0,
        timestamp=record.timestamp.strftime("%Y-%m-%d %H:%M") if record.timestamp else "—",
    )

    try:
        resp = req.post(
            "https://api.deepseek.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 600,
            },
            timeout=30,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        ai_data = json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 生成失败: {e}")

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    prev_status = record.status
    record.dispatch_info = {
        **ai_data,
        "dispatched_at": now_iso,
        "dispatched_by": current_user.username,
        "ai_generated": True,
    }
    record.status = "processing"
    record.worker_name = current_user.username

    # 审计日志
    db.add(AuditLog(
        entity_type="record",
        entity_id=str(record.id),
        from_status=prev_status,
        to_status="processing",
        operator_id=current_user.id,
        note=f"AI 派单 by {current_user.username}",
    ))
    # 同步 cluster 状态
    if record.cluster_id:
        cluster = db.query(DiseaseCluster).filter(
            DiseaseCluster.cluster_id == record.cluster_id
        ).first()
        if cluster and cluster.status != "processing":
            db.add(AuditLog(
                entity_type="cluster",
                entity_id=cluster.cluster_id,
                from_status=cluster.status,
                to_status="processing",
                operator_id=current_user.id,
                note=f"AI 派单触发 by {current_user.username}",
            ))
            cluster.status = "processing"
            cluster.worker_id = current_user.id

    db.commit()
    db.refresh(record)

    return DispatchOut(
        record_id=record.id,
        label_cn=record.label_cn or "—",
        dispatched_at=now_iso,
        urgency=ai_data.get("urgency", "低危"),
        repair_method=ai_data.get("repair_method", ""),
        material_estimate=ai_data.get("material_estimate", []),
        estimated_hours=float(ai_data.get("estimated_hours", 1)),
        safety_notes=ai_data.get("safety_notes", ""),
        priority_reason=ai_data.get("priority_reason", ""),
    )


# ── 工单列表（移动端拉取）─────────────────────────────────────────────────────
@router.get("/orders")
def get_orders(
    status: Optional[str] = Query(None, description="pending|processing|repaired"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """返回已派发工单（dispatch_info 不为空），不需要登录。"""
    q = db.query(DiseaseRecord).filter(
        DiseaseRecord.dispatch_info != None,
        DiseaseRecord.deleted_at == None,
    )
    if status:
        q = q.filter(DiseaseRecord.status == status)
    records = q.order_by(DiseaseRecord.timestamp.desc()).limit(limit).all()

    result = []
    for r in records:
        info = r.dispatch_info or {}
        result.append({
            "id":               r.id,
            "order_no":         f"LS-{r.id:04d}",
            "label_cn":         r.label_cn or "未知",
            "label":            r.label or "—",
            "urgency":          info.get("urgency", "低危"),
            "status":           r.status,
            "repair_method":    info.get("repair_method", ""),
            "material_estimate": info.get("material_estimate", []),
            "estimated_hours":  info.get("estimated_hours", 0),
            "safety_notes":     info.get("safety_notes", ""),
            "priority_reason":  info.get("priority_reason", ""),
            "worker_name":      r.worker_name,
            "lat":              r.lat,
            "lng":              r.lng,
            "dispatched_at":    info.get("dispatched_at"),
            "dispatched_by":    info.get("dispatched_by"),
            "timestamp":        r.timestamp.isoformat() if r.timestamp else None,
        })
    return result


# ── 巡检员更新工单状态 ────────────────────────────────────────────────────────
@router.patch("/orders/{record_id}/status")
def update_order_status(
    record_id: int,
    body: OrderStatusUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """巡检员接单（processing）或标记完工（repaired）。"""
    if body.status not in {"processing", "repaired"}:
        raise HTTPException(status_code=400, detail="状态仅可为 processing 或 repaired")

    record = db.query(DiseaseRecord).filter(
        DiseaseRecord.id == record_id,
        DiseaseRecord.deleted_at == None,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="工单不存在")

    prev_status = record.status
    record.status = body.status
    record.worker_name = current_user.username
    if body.status == "repaired":
        record.repaired_at = datetime.now(tz=timezone.utc)

    db.add(AuditLog(
        entity_type="record",
        entity_id=str(record.id),
        from_status=prev_status,
        to_status=body.status,
        operator_id=current_user.id,
        note=f"巡检员 {current_user.username} 更新",
    ))
    if record.cluster_id:
        cluster = db.query(DiseaseCluster).filter(
            DiseaseCluster.cluster_id == record.cluster_id
        ).first()
        if cluster and cluster.status != body.status:
            db.add(AuditLog(
                entity_type="cluster",
                entity_id=cluster.cluster_id,
                from_status=cluster.status,
                to_status=body.status,
                operator_id=current_user.id,
            ))
            cluster.status = body.status
            if body.status == "repaired":
                cluster.repaired_at = record.repaired_at

    db.commit()
    return {"ok": True, "status": body.status}
