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

/** 根据工单状态返回标记颜色，待修时保留病害原色 */
export function statusColor(item) {
  const st = item.status || 'pending'
  if (st === 'repaired')   return '#22c55e'
  if (st === 'processing') return '#f97316'
  return item.color_hex || '#ef4444'
}

/** 生成单个病害记录的 InfoWindow HTML 字符串 */
export function buildInfoWindowHtml(item) {
  const color  = statusColor(item)
  const dColor = item.color_hex || '#ff4444'
  const conf   = item.confidence != null ? (item.confidence * 100).toFixed(1) : '--'
  const ts     = item.timestamp
    ? new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false })
    : '--'
  const stLabel = STATUS_LABEL[item.status] || '待修'
  const lat = parseFloat(item.lat)
  const lng = parseFloat(item.lng)

  return `
    <div style="
      background:rgba(8,12,26,0.96);
      border:1px solid rgba(255,255,255,0.12);
      border-radius:10px;
      padding:0;
      min-width:220px;
      font-family:-apple-system,'PingFang SC',sans-serif;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
      overflow:hidden;
      position:relative;
    ">
      <!-- 顶部色带 -->
      <div style="
        background:${dColor};
        padding:10px 14px 8px;
        display:flex;align-items:center;gap:8px;
      ">
        <span style="font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);">
          ${item.label_cn || '未知病害'}
        </span>
        <span style="
          margin-left:auto;font-size:11px;
          background:rgba(0,0,0,0.25);color:#fff;
          border-radius:4px;padding:1px 6px;
        ">${item.label || ''}</span>
      </div>

      <!-- 详情区 -->
      <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
        <!-- 工单状态 -->
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="font-size:11px;color:#9ca3af;white-space:nowrap;">工单状态</span>
          <span style="
            font-size:11px;font-weight:600;color:${color};
            background:${color}22;border:1px solid ${color}55;
            border-radius:3px;padding:1px 7px;
          ">${stLabel}</span>
          ${item.worker_name
            ? `<span style="font-size:11px;color:#9ca3af;">· ${item.worker_name}</span>`
            : ''}
        </div>

        <!-- 置信度进度条 -->
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:#9ca3af;">置信度</span>
            <span style="font-size:12px;font-weight:600;color:#fff;">${conf}%</span>
          </div>
          <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.1);">
            <div style="height:100%;border-radius:2px;width:${conf}%;background:${dColor};transition:width 0.3s;"></div>
          </div>
        </div>

        <!-- 坐标 -->
        <div style="display:flex;gap:6px;">
          <span style="font-size:11px;color:#9ca3af;white-space:nowrap;">经纬度</span>
          <span style="font-size:11px;color:#e5e7eb;font-variant-numeric:tabular-nums;">
            ${lat.toFixed(5)}, ${lng.toFixed(5)}
          </span>
        </div>

        <!-- 时间 -->
        <div style="display:flex;gap:6px;">
          <span style="font-size:11px;color:#9ca3af;white-space:nowrap;">检测时间</span>
          <span style="font-size:11px;color:#e5e7eb;">${ts}</span>
        </div>

        ${item.filename ? `
        <div style="display:flex;gap:6px;">
          <span style="font-size:11px;color:#9ca3af;white-space:nowrap;">来源文件</span>
          <span style="font-size:11px;color:#e5e7eb;word-break:break-all;">${item.filename}</span>
        </div>` : ''}

        <!-- 演变时间轴按钮 -->
        <div
          onclick="window.__lsShowTimeline(${item.id})"
          style="
            margin-top:4px;
            display:flex;align-items:center;justify-content:center;gap:6px;
            background:${dColor}22;border:1px solid ${dColor}55;
            border-radius:6px;padding:7px 0;
            cursor:pointer;font-size:12px;font-weight:600;color:${dColor};
            transition:background 0.15s;
          "
          onmouseover="this.style.background='${dColor}40'"
          onmouseout="this.style.background='${dColor}22'"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
            style="flex-shrink:0">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          演变时间轴
        </div>

        <!-- AI 派发工单按钮 -->
        ${item.dispatch_info ? `
        <div style="
          margin-top:4px;padding:7px 0;border-radius:6px;
          background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.35);
          display:flex;align-items:center;justify-content:center;gap:6px;
          font-size:12px;font-weight:600;color:#22c55e;
        ">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          已派发 · ${item.dispatch_info.urgency || ''}
        </div>` : `
        <button
          id="ls-dispatch-btn-${item.id}"
          onclick="window.__lsDispatchOrder(${item.id})"
          style="
            margin-top:4px;width:100%;padding:7px 0;border-radius:6px;
            background:rgba(62,106,225,0.12);border:1px solid rgba(62,106,225,0.4);
            display:flex;align-items:center;justify-content:center;gap:6px;
            font-size:12px;font-weight:600;color:#93b4f7;cursor:pointer;
            transition:background 0.15s;
          "
          onmouseover="this.style.background='rgba(62,106,225,0.22)'"
          onmouseout="this.style.background='rgba(62,106,225,0.12)'"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          AI 派发工单
        </button>`}
      </div><!-- /详情区 -->
      </div><!-- /详情区 -->

      <!-- 关闭按钮 -->
      <div
        onclick="window.__lsCloseInfoWindow()"
        style="
          position:absolute;top:8px;right:10px;
          color:rgba(255,255,255,0.6);font-size:16px;
          cursor:pointer;line-height:1;
        ">×</div>
    </div>
  `
}
