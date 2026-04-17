import { useEffect, useState, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { getClusterTimeline } from '../../api/client'
import s from './TimelineModal.module.css'

const TREND_CONFIG = {
  deteriorating: { label: '持续恶化',   color: '#ef4444', arrow: '↑' },
  improving:     { label: '有改善趋势', color: '#22c55e', arrow: '↓' },
  stable:        { label: '暂无明显变化', color: '#9ca3af', arrow: '—' },
}

function fmt(iso) {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}

function fmtFull(iso) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

export default function TimelineModal({ recordId, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (!recordId) return
    setLoading(true)
    setError('')
    setData(null)
    getClusterTimeline(recordId)
      .then(setData)
      .catch(e => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [recordId])

  const chartOption = useMemo(() => {
    if (!data?.timeline?.length) return null

    const tl    = data.timeline
    const xData = tl.map(t => fmt(t.timestamp))
    const confData  = tl.map(t => t.confidence != null ? +(t.confidence * 100).toFixed(1) : null)
    const areaData  = tl.map(t => t.bbox_area)
    const hasArea   = areaData.some(v => v != null)
    const color     = data.color_hex || '#ef4444'

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(8,12,26,0.95)',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#e5e7eb', fontSize: 12 },
        formatter: params => {
          const idx = params[0]?.dataIndex
          if (idx == null) return ''
          const entry = tl[idx]
          let html = `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">${fmtFull(entry.timestamp)}</div>`
          params.forEach(p => {
            if (p.value == null) return
            html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};"></span>
              <span style="color:#9ca3af;">${p.seriesName}</span>
              <strong style="color:#fff;margin-left:auto;padding-left:12px;">${p.value}${p.seriesName === '置信度' ? '%' : ' px²'}</strong>
            </div>`
          })
          return html
        },
      },
      legend: {
        top: 6, left: 'center',
        textStyle: { color: '#9ca3af', fontSize: 11 },
        itemWidth: 12, itemHeight: 8,
        itemGap: 20,
      },
      grid: { left: 8, right: hasArea ? 48 : 8, bottom: 4, top: 34, containLabel: true },
      xAxis: {
        type: 'category', data: xData, boundaryGap: false,
        axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value', min: 0, max: 100,
          axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 10, formatter: v => `${v}%` },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' } },
        },
        ...(hasArea ? [{
          type: 'value',
          axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 10, formatter: v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v },
          splitLine: { show: false },
        }] : []),
      ],
      series: [
        {
          name: '置信度', type: 'line', yAxisIndex: 0,
          data: confData, smooth: 0.3, connectNulls: true,
          lineStyle: { color, width: 2.5 },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: color + '55' },
                { offset: 1, color: color + '08' },
              ]
            }
          },
          symbol: 'circle', symbolSize: 7,
          itemStyle: { color, borderColor: '#fff', borderWidth: 1.5 },
          markLine: tl.length >= 2 ? {
            silent: true,
            lineStyle: { color: 'rgba(255,255,255,0.12)', type: 'dashed' },
            data: [{ type: 'average', name: '均值', label: { color: 'rgba(255,255,255,0.3)', fontSize: 10, formatter: p => `均${p.value.toFixed(1)}%` } }],
          } : undefined,
        },
        ...(hasArea ? [{
          name: '损伤面积', type: 'bar', yAxisIndex: 1,
          data: areaData,
          barMaxWidth: 18,
          itemStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(249,115,22,0.75)' },
                { offset: 1, color: 'rgba(249,115,22,0.15)' },
              ]
            },
            borderRadius: [3, 3, 0, 0],
          },
        }] : []),
      ],
    }
  }, [data])

  const trend    = data ? TREND_CONFIG[data.trend] ?? TREND_CONFIG.stable : null
  const firstTs  = data?.timeline?.[0]?.timestamp
  const lastTs   = data?.timeline?.at?.(-1)?.timestamp
  const maxConf  = data?.timeline ? Math.max(...data.timeline.map(t => t.confidence ?? 0)) * 100 : 0
  const latestConf = data?.timeline?.at?.(-1)?.confidence != null
    ? (data.timeline.at(-1).confidence * 100).toFixed(1)
    : '--'

  return (
    <div className={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={s.modal}>

        {/* ── 顶部色带 ── */}
        <div className={s.header} style={{ borderBottom: `3px solid ${data?.color_hex || '#ef4444'}` }}>
          <div className={s.headerLeft}>
            <span
              className={s.dot}
              style={{ background: data?.color_hex || '#ef4444', boxShadow: `0 0 8px ${data?.color_hex || '#ef4444'}` }}
            />
            <span className={s.title}>{data?.label_cn || '演变时间轴'}</span>
            <span className={s.subtitle}>{data?.label || ''}</span>
          </div>
          {trend && (
            <span className={s.trendBadge} style={{ color: trend.color, borderColor: trend.color + '55', background: trend.color + '18' }}>
              {trend.arrow} {trend.label}
            </span>
          )}
          <button className={s.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* ── 主体 ── */}
        <div className={s.body}>
          {loading && (
            <div className={s.center}>
              <div className={s.spinner} />
              <span>加载时间轴数据…</span>
            </div>
          )}

          {!loading && error && (
            <div className={s.center} style={{ color: '#ef4444' }}>
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* 统计摘要 */}
              <div className={s.statsRow}>
                <div className={s.statItem}>
                  <span className={s.statVal}>{data.total}</span>
                  <span className={s.statLabel}>次检测</span>
                </div>
                <div className={s.statItem}>
                  <span className={s.statVal}>{latestConf}%</span>
                  <span className={s.statLabel}>最新置信度</span>
                </div>
                <div className={s.statItem}>
                  <span className={s.statVal}>{maxConf.toFixed(1)}%</span>
                  <span className={s.statLabel}>峰值置信度</span>
                </div>
                {firstTs && lastTs && firstTs !== lastTs && (
                  <div className={s.statItem}>
                    <span className={s.statVal}>{fmt(firstTs)} → {fmt(lastTs)}</span>
                    <span className={s.statLabel}>记录跨度</span>
                  </div>
                )}
              </div>

              {/* 趋势说明 */}
              {data.total === 1 && (
                <p className={s.hint}>仅有 1 次检测记录，积累更多巡检数据后可查看趋势</p>
              )}

              {/* ECharts 双轴图 */}
              {chartOption && (
                <ReactECharts
                  option={chartOption}
                  style={{ width: '100%', height: '240px' }}
                  notMerge
                />
              )}

              {/* 时间轴列表 */}
              {data.total > 1 && (
                <div className={s.list}>
                  <div className={s.listHeader}>检测记录明细</div>
                  {[...data.timeline].reverse().map((entry, i) => (
                    <div key={entry.id} className={s.listRow}>
                      <span className={s.listIndex}>{data.total - i}</span>
                      <span className={s.listTime}>{fmtFull(entry.timestamp)}</span>
                      <span className={s.listConf} style={{ color: data.color_hex || '#ef4444' }}>
                        {entry.confidence != null ? `${(entry.confidence * 100).toFixed(1)}%` : '--'}
                      </span>
                      {entry.bbox_area != null && (
                        <span className={s.listArea}>
                          {entry.bbox_area >= 1000
                            ? `${(entry.bbox_area / 1000).toFixed(1)}K px²`
                            : `${entry.bbox_area} px²`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
