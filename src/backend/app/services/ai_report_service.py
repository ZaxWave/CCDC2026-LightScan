import os
from collections import Counter
from datetime import datetime, timezone
from typing import Optional
import httpx

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"


def _build_report_prompt(records: list, area: str, days: int) -> str:
    total = len(records)
    label_counter = Counter(r.label_cn or r.label for r in records)
    status_counter = Counter(r.status for r in records)

    label_lines = "\n".join(
        f"  - {label}：{cnt} 处" for label, cnt in label_counter.most_common()
    )
    status_lines = (
        f"  - 待处理：{status_counter.get('pending', 0)} 条\n"
        f"  - 处理中：{status_counter.get('processing', 0)} 条\n"
        f"  - 已修复：{status_counter.get('repaired', 0)} 条"
    )

    # ── 演化趋势分析：按 cluster 分组计算趋势 ──────────────────────────────
    from collections import defaultdict
    cluster_records: dict = defaultdict(list)
    for r in records:
        if r.cluster_id and r.confidence is not None:
            t = r.captured_at or r.timestamp
            cluster_records[r.cluster_id].append((t, r.confidence, r.label_cn or r.label))

    deteriorating, improving, multi_source = [], [], []
    for cid, obs in cluster_records.items():
        obs_sorted = sorted(obs, key=lambda x: x[0] or datetime.min)
        if len(obs_sorted) < 2:
            continue
        conf_vals = [c for _, c, _ in obs_sorted]
        delta = conf_vals[-1] - conf_vals[0]
        label = obs_sorted[-1][2]
        if delta > 0.05:
            deteriorating.append(f"{label}（+{delta*100:.1f}%，{len(obs_sorted)} 次观测）")
        elif delta < -0.05:
            improving.append(f"{label}（{delta*100:.1f}%，已改善）")

    # 多数据源证据（同 cluster 有 ≥2 条记录）
    source_counter = Counter(r.cluster_id for r in records if r.cluster_id)
    multi_obs = [(cid, cnt) for cid, cnt in source_counter.most_common(5) if cnt >= 2]
    multi_lines = "\n".join(
        f"  - 聚类 {cid[:8]}…（{cnt} 次多源观测）" for cid, cnt in multi_obs
    ) or "  - 无"

    det_lines = "\n".join(f"  - {s}" for s in deteriorating[:5]) or "  - 无"
    imp_lines = "\n".join(f"  - {s}" for s in improving[:3]) or "  - 无"

    return f"""你是一名专业的道路养护管理助手。
请根据以下 LightScan 系统在「{area}」近 {days} 天内采集的病害数据摘要，
生成一份简洁的巡检周报，并给出养护优先级建议。

【数据摘要】
- 统计时间：最近 {days} 天
- 病害总记录数：{total} 条
- 病害类型分布：
{label_lines}
- 工单处理状态：
{status_lines}

【演化趋势分析】
- 持续恶化的病害点（置信度上升 >5%）：
{det_lines}
- 已改善的病害点（置信度下降 >5%）：
{imp_lines}
- 多源重复观测聚类（行车记录仪/手机/监控等多视角证据）：
{multi_lines}

【输出要求】
1. 巡检概况（2~3 句）
2. 重点关注区域与病害类型（分条）
3. 演化趋势分析：重点描述持续恶化的病害点及潜在风险
4. 养护优先级建议（按紧急程度排序，恶化中的优先，不超过 5 条）
5. 短期处置建议（1~2 句）

请用中文输出，风格专业简洁，不需要重复列出原始数据。"""


def _build_cluster_advice_prompt(label_cn: str, timeline: list) -> str:
    n = len(timeline)
    if n == 0:
        return ""
    first = timeline[0]
    last = timeline[-1]
    conf_vals = [t["confidence"] for t in timeline if t["confidence"] is not None]
    trend_str = "数据不足"
    if len(conf_vals) >= 2:
        delta = conf_vals[-1] - conf_vals[0]
        trend_str = "持续恶化" if delta > 0.05 else ("逐步改善" if delta < -0.05 else "基本稳定")

    return f"""你是一名专业的道路养护工程师。
请根据以下单个病害点的时序观测数据，给出具体的养护处置建议。

【病害点信息】
- 病害类型：{label_cn}
- 历史观测次数：{n} 次
- 首次发现：{first.get('timestamp', '未知')}
- 最近观测：{last.get('timestamp', '未知')}
- 趋势判断：{trend_str}
- 当前工单状态：{last.get('status', '未知')}

【输出要求】
1. 病害状态评估（1~2 句）
2. 处置建议（具体工艺或材料，2~3 条）
3. 处置优先级：紧急 / 一般 / 可延后（并说明理由）

请用中文输出，100 字以内。"""


async def call_deepseek(prompt: str) -> str:
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY，请在 .env 中添加")

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.4,
        "max_tokens": 800,
    }
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(DEEPSEEK_BASE_URL, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def generate_area_report(records: list, area: str = "全辖区", days: int = 7) -> str:
    prompt = _build_report_prompt(records, area, days)
    return await call_deepseek(prompt)


async def generate_cluster_advice(label_cn: str, timeline: list) -> str:
    prompt = _build_cluster_advice_prompt(label_cn, timeline)
    if not prompt:
        return "暂无足够的历史数据生成建议。"
    return await call_deepseek(prompt)
