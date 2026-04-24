"""
/api/v1/report — 智能巡检周报生成
  POST /weekly  收集当前用户本周数据，调用 DeepSeek 生成专业周报文本
"""
import os
import requests as req
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional

from app.db.database import get_db
from app.db.models import DiseaseRecord
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/v1/report", tags=["Report"])

# 病害严重程度权重（用于周报描述）
SEVERITY = {
    "D40": ("坑槽",   "高"),
    "D20": ("网状裂缝", "中"),
    "D10": ("纵横裂缝", "中"),
    "D00": ("横向裂缝", "低"),
}


class WeeklyReportResponse(BaseModel):
    report_text: str
    stats: dict
    generated_at: str
    week_range: str
    operator: str
    top_locations: list  # 置信度最高的前 5 处病害坐标，用于 PDF 报告


@router.post("/weekly", response_model=WeeklyReportResponse)
def generate_weekly_report(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """调用 DeepSeek Chat 生成本周巡检周报"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY 未配置，请在 .env 中设置")

    # ── 1. 拉取本周数据 ─────────────────────────────────────────
    now = datetime.now(tz=timezone.utc)
    # 本周一 00:00 UTC
    week_start = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    records = (
        db.query(DiseaseRecord)
        .filter(
            DiseaseRecord.creator_id == current_user.id,
            DiseaseRecord.timestamp >= week_start,
        )
        .all()
    )

    # ── 2. 统计数据 ─────────────────────────────────────────────
    type_counts: dict[str, int] = {}
    severity_counts = {"高": 0, "中": 0, "低": 0}
    conf_high = conf_mid = conf_low = 0

    for r in records:
        # 类型统计
        name = r.label_cn or SEVERITY.get(r.label or "", (r.label, "—"))[0] or "未知"
        type_counts[name] = type_counts.get(name, 0) + 1
        # 严重程度
        sev = SEVERITY.get(r.label or "", (None, "低"))[1]
        severity_counts[sev] = severity_counts.get(sev, 0) + 1
        # 置信度分布
        c = r.confidence or 0
        if c >= 0.8:   conf_high += 1
        elif c >= 0.6: conf_mid  += 1
        else:          conf_low  += 1

    total = len(records)
    type_lines = "\n".join(f"  · {k}：{v} 处" for k, v in type_counts.items()) or "  · 无检出记录"

    # ── 3. 构建 Prompt ──────────────────────────────────────────
    prompt = f"""你是一位专业的道路养护工程师，请根据以下智能巡检系统采集的数据，生成一份正式的道路巡检周报。

【巡检周期】{week_start.strftime('%Y年%m月%d日')} — {now.strftime('%Y年%m月%d日')}
【操作员】{current_user.username}
【本周检出病害总数】{total} 处

【病害类型分布】
{type_lines}

【严重程度分布】
  · 高危（坑槽类）：{severity_counts['高']} 处
  · 中危（裂缝扩展）：{severity_counts['中']} 处
  · 低危（轻微裂缝）：{severity_counts['低']} 处

【检测置信度分布】
  · 高置信度（≥80%）：{conf_high} 处
  · 中置信度（60-79%）：{conf_mid} 处
  · 低置信度（<60%）：{conf_low} 处（建议人工复核）

请生成一份包含以下五个章节的专业周报（总字数 350-500 字，使用正式技术语言）：
一、巡检概况
二、主要病害分析与危害等级评估
三、重点关注区域与风险预警
四、养护处置建议（按优先级排列）
五、下周巡检重点部署

要求：内容专业、客观、逻辑清晰，避免使用过于口语化的表达。"""

    # ── 4. 调用 DeepSeek API ────────────────────────────────────
    try:
        resp = req.post(
            "https://api.deepseek.com/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.6,
                "max_tokens": 1200,
            },
            timeout=90,
        )
        resp.raise_for_status()
        report_text = resp.json()["choices"][0]["message"]["content"]
    except req.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="DeepSeek 响应超时，请稍后重试")
    except req.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"调用 DeepSeek 失败：{e}")
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail="DeepSeek 返回格式异常")

    # 置信度最高的前 5 处病害（优先取坑槽 D40），用于 PDF 中的重点位置表
    sorted_records = sorted(
        [r for r in records if r.lat and r.lng],
        key=lambda r: (r.label == "D40", r.confidence or 0),
        reverse=True,
    )
    top_locations = [
        {
            "label_cn": r.label_cn or SEVERITY.get(r.label or "", (r.label, "—"))[0] or "未知",
            "lat": round(r.lat, 5),
            "lng": round(r.lng, 5),
            "confidence": round(r.confidence, 2) if r.confidence else None,
            "timestamp": r.timestamp.strftime("%Y-%m-%d %H:%M") if r.timestamp else None,
        }
        for r in sorted_records[:5]
    ]

    return WeeklyReportResponse(
        report_text=report_text,
        stats={
            "total": total,
            "by_type": type_counts,
            "severity": severity_counts,
            "confidence": {"high": conf_high, "mid": conf_mid, "low": conf_low},
        },
        generated_at=now.strftime("%Y-%m-%d %H:%M"),
        week_range=f"{week_start.strftime('%Y-%m-%d')} ~ {now.strftime('%Y-%m-%d')}",
        operator=current_user.username,
        top_locations=top_locations,
    )
