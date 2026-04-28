/**
 * MarkerInfoWindow.js
 * 地图标记点击弹窗的 HTML 生成工具。
 * AMap InfoWindow 使用原生 HTML 字符串，无法直接嵌入 React 组件，
 * 因此单独抽成工具函数供 ClusterLayer 调用。
 */

export const STATUS_LABEL = {
  pending:    '待修',
  processing: '维修中',
  repaired:   '已修',
}

const SOURCE_LABEL = {
  dashcam:       '行车记录仪',
  mobile:        '手机',
  camera:        '监控',
  drone:         '无人机',
  manual:        '手动',
  bus_dashcam:   '公交记录仪',
  street_camera: '路侧摄像',
}

/** 根据工单状态返回标记颜色，待修时保留病害原色 */
export function statusColor(item) {
  const st = item.status || 'pending'
  if (st === 'repaired')   return '#22c55e'
  if (st === 'processing') return '#f97316'
  return item.color_hex || '#ef4444'
}

function fmtTs(ts) {
  if (!ts) return '--'
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }) }
  catch { return ts }
}

/**
 * 生成聚类弹窗 HTML（同一 cluster_id 的所有病害记录）
 * @param {object[]} items - 同 cluster 的 DiseaseRecord 列表（已过滤 label_cn != null）
 * @param {object[]} allItems - 含补充视角的完整列表，用于统计来源数
 */
export function buildClusterInfoWindowHtml(items, allItems) {
  if (!items || items.length === 0) return ''

  // 取最新时间戳的记录作为代表
  const sorted = [...items].sort((a, b) =>
    new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
  )
  const rep = sorted[0]
  const lat = parseFloat(rep.lat)
  const lng = parseFloat(rep.lng)

  // 来源统计（含补充视角）
  const sourceSet = new Set((allItems || items).map(r => r.source_type).filter(Boolean))
  const sourceStr = [...sourceSet].map(s => SOURCE_LABEL[s] || s).join(' · ') || '未知来源'
  const totalViews = (allItems || items).length

  // 多病害行
  const diseaseRows = items.map(item => {
    const color = statusColor(item)
    const dColor = item.color_hex || '#ef4444'
    const conf = item.confidence != null ? (item.confidence * 100).toFixed(1) : '--'
    const stLabel = STATUS_LABEL[item.status] || '待修'
    return `
      <div style="
        display:flex;align-items:center;gap:8px;
        padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);
      ">
        <span style="
          display:inline-block;width:8px;height:8px;border-radius:50%;
          background:${dColor};flex-shrink:0;
        "></span>
        <span style="font-size:13px;font-weight:600;color:#f3f4f6;flex:1;">
          ${item.label_cn || '未知'}
        </span>
        <span style="font-size:11px;color:${dColor};font-variant-numeric:tabular-nums;">
          ${conf}%
        </span>
        <span style="
          font-size:10px;color:${color};
          background:${color}22;border:1px solid ${color}44;
          border-radius:3px;padding:1px 5px;white-space:nowrap;
        ">${stLabel}</span>
        <div
          onclick="window.__lsShowTimeline(${item.id})"
          title="演变时间轴"
          style="
            width:22px;height:22px;border-radius:4px;
            background:${dColor}22;border:1px solid ${dColor}44;
            display:flex;align-items:center;justify-content:center;
            cursor:pointer;flex-shrink:0;
          "
          onmouseover="this.style.background='${dColor}44'"
          onmouseout="this.style.background='${dColor}22'"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="${dColor}" stroke-width="2.5" stroke-linecap="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </div>
      </div>
    `
  }).join('')

  return `
    <div style="
      background:rgba(8,12,26,0.97);
      border:1px solid rgba(255,255,255,0.12);
      border-radius:10px;
      padding:0;
      min-width:240px;max-width:280px;
      font-family:-apple-system,'PingFang SC',sans-serif;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
      overflow:hidden;position:relative;
    ">
      <!-- 顶部色带：来源统计 -->
      <div style="
        background:linear-gradient(135deg,rgba(59,130,246,0.35),rgba(139,92,246,0.25));
        padding:10px 14px 8px;border-bottom:1px solid rgba(255,255,255,0.08);
      ">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="#93c5fd" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span style="font-size:11px;color:#93c5fd;font-weight:600;">
            ${totalViews} 张视角 · ${sourceStr}
          </span>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.45);font-variant-numeric:tabular-nums;">
          ${lat.toFixed(5)}, ${lng.toFixed(5)} · ${fmtTs(rep.timestamp)}
        </div>
      </div>

      <!-- 病害列表 -->
      <div style="padding:4px 14px 0;">
        ${diseaseRows}
      </div>

      <!-- 操作按钮区 -->
      <div style="padding:10px 14px 12px;display:flex;flex-direction:column;gap:7px;">
        <!-- 多源融合全景 -->
        <div
          onclick="window.__lsShowFusion(${rep.id})"
          style="
            display:flex;align-items:center;justify-content:center;gap:6px;
            background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.45);
            border-radius:6px;padding:8px 0;
            cursor:pointer;font-size:12px;font-weight:600;color:#93c5fd;
          "
          onmouseover="this.style.background='rgba(59,130,246,0.24)'"
          onmouseout="this.style.background='rgba(59,130,246,0.12)'"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          多源融合全景
        </div>

        <!-- AI 派发工单（取最新未派发记录） -->
        ${rep.dispatch_info ? `
        <div style="
          padding:7px 0;border-radius:6px;
          background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.35);
          display:flex;align-items:center;justify-content:center;gap:6px;
          font-size:12px;font-weight:600;color:#22c55e;
        ">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          已派发 · ${rep.dispatch_info.urgency || ''}
        </div>` : `
        <button
          id="ls-dispatch-btn-${rep.id}"
          onclick="window.__lsDispatchOrder(${rep.id})"
          style="
            width:100%;padding:7px 0;border-radius:6px;
            background:rgba(62,106,225,0.12);border:1px solid rgba(62,106,225,0.4);
            display:flex;align-items:center;justify-content:center;gap:6px;
            font-size:12px;font-weight:600;color:#93b4f7;cursor:pointer;
          "
          onmouseover="this.style.background='rgba(62,106,225,0.22)'"
          onmouseout="this.style.background='rgba(62,106,225,0.12)'"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          AI 派发工单
        </button>`}
      </div>

      <!-- 关闭按钮 -->
      <div
        onclick="window.__lsCloseInfoWindow()"
        style="
          position:absolute;top:8px;right:10px;
          color:rgba(255,255,255,0.5);font-size:16px;
          cursor:pointer;line-height:1;
        ">×</div>
    </div>
  `
}

/** 单条记录弹窗（向后兼容，暂保留） */
export function buildInfoWindowHtml(item) {
  return buildClusterInfoWindowHtml([item], [item])
}
