import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { getClusterFusion } from '../../api/client'
import s from './FusionModal.module.css'

// ── 数据来源元数据 ────────────────────────────────────────────────────────────
const SOURCE_META = {
  bus_dashcam:   { label: '公交记录仪', color: '#3b82f6' },
  dashcam:       { label: '行车记录仪', color: '#8b5cf6' },
  mobile:        { label: '手机拍摄',   color: '#22c55e' },
  camera:        { label: '路侧摄像头', color: '#f97316' },
  street_camera: { label: '路侧监控',   color: '#f97316' },
  drone:         { label: '无人机',     color: '#06b6d4' },
  manual:        { label: '手动上传',   color: '#9ca3af' },
  unknown:       { label: '未知来源',   color: '#6b7280' },
}

const CARD_W = 210
const CARD_H = 148

function getRadius(n) {
  if (n <= 1) return 0
  return Math.max(130, (CARD_W + 22) / (2 * Math.sin(Math.PI / n)))
}

function fmtTs(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

// ── CSS 3D 旋转全景组件 ───────────────────────────────────────────────────────
function PanoramaRing({ evidence, color }) {
  const n       = evidence.length
  const radius  = getRadius(n)
  const perAngle = n > 0 ? 360 / n : 360

  const stageRef  = useRef(null)
  const ringRef   = useRef(null)
  const angleRef  = useRef(0)
  const rafRef    = useRef(null)
  const dragRef   = useRef(null)      // { startX, startAngle, lastX, lastT }
  const velRef    = useRef(0)         // inertia
  const autoRef   = useRef(true)      // auto-rotate on/off
  const resumeRef = useRef(null)      // resume timer

  const [activeIdx, setActiveIdx]   = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // 更新 DOM 上的 transform（不走 React re-render，保证 60fps）
  const applyTransform = useCallback(() => {
    if (ringRef.current) {
      ringRef.current.style.transform = `rotateY(${angleRef.current}deg)`
    }
    // 每 150ms 更新一次 activeIdx（dot 指示器）
  }, [])

  // RAF 动画主循环
  const tick = useCallback(() => {
    if (!dragRef.current) {
      if (autoRef.current) {
        angleRef.current += 0.18
      } else if (Math.abs(velRef.current) > 0.05) {
        angleRef.current += velRef.current
        velRef.current   *= 0.93
      }
    }
    applyTransform()
    rafRef.current = requestAnimationFrame(tick)
  }, [applyTransform])

  // 每 120ms 同步 activeIdx 到 React state（控制高亮和 dots）
  useEffect(() => {
    const id = setInterval(() => {
      if (n < 1) return
      const norm = ((-angleRef.current % 360) + 360) % 360
      setActiveIdx(Math.round(norm / perAngle) % n)
    }, 120)
    return () => clearInterval(id)
  }, [n, perAngle])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      clearTimeout(resumeRef.current)
    }
  }, [tick])

  const stopAuto = useCallback(() => {
    autoRef.current = false
    clearTimeout(resumeRef.current)
    resumeRef.current = setTimeout(() => { autoRef.current = true }, 2200)
  }, [])

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    stageRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startAngle: angleRef.current, lastX: e.clientX, lastT: Date.now() }
    velRef.current  = 0
    stopAuto()
    setIsDragging(true)
  }, [stopAuto])

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return
    const now = Date.now()
    const dx  = e.clientX - dragRef.current.lastX
    velRef.current = dx / Math.max(now - dragRef.current.lastT, 1) * 16
    dragRef.current.lastX = e.clientX
    dragRef.current.lastT = now
    angleRef.current = dragRef.current.startAngle + (e.clientX - dragRef.current.startX) * 0.45
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    setIsDragging(false)
    resumeRef.current = setTimeout(() => { autoRef.current = true }, 2200)
  }, [])

  if (n === 0) return null

  // 舞台宽度：单图时居中，多图时宽度覆盖整个圆柱前视野
  const stageW = n === 1 ? CARD_W + 48 : Math.min(688, radius * 2 + CARD_W + 32)
  const stageH = CARD_H + 24

  return (
    <div className={s.panoOuter}>
      {/* 3D 舞台 */}
      <div
        ref={stageRef}
        className={s.panoStage}
        style={{ width: stageW, height: stageH, cursor: isDragging ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* 旋转环 */}
        <div
          ref={ringRef}
          className={s.panoRing}
          style={{
            width:     CARD_W,
            height:    CARD_H,
            top:       '50%',
            left:      '50%',
            marginTop: -(CARD_H / 2),
            marginLeft:-(CARD_W / 2),
          }}
        >
          {evidence.map((item, i) => {
            const rotY    = perAngle * i
            const isActive = i === activeIdx
            const srcMeta = SOURCE_META[item.source_type] || SOURCE_META.unknown
            const thumb   = item.thumbnail_b64

            return (
              <div
                key={item.id}
                className={s.panoCard}
                style={{
                  width:  CARD_W,
                  height: CARD_H,
                  transform: `rotateY(${rotY}deg) translateZ(${radius}px)`,
                  border: `2px solid ${isActive ? color : 'rgba(255,255,255,0.08)'}`,
                  boxShadow: isActive ? `0 0 24px ${color}55, inset 0 0 0 1px ${color}30` : 'none',
                  filter: isActive ? 'none' : 'brightness(0.45) saturate(0.7)',
                  zIndex: isActive ? 2 : 1,
                }}
              >
                {thumb ? (
                  <img
                    src={thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 6, pointerEvents: 'none' }}
                    alt="evidence"
                    draggable={false}
                  />
                ) : (
                  <div className={s.panoNoImg} style={{ background: `${srcMeta.color}12` }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
                      stroke={srcMeta.color} strokeWidth="1.2" opacity="0.4">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                  </div>
                )}

                {/* 来源徽章 */}
                <div className={s.panoCardBadge}
                  style={{ background: srcMeta.color + 'cc' }}>
                  {srcMeta.label}
                </div>

                {/* 置信度 / 补充视角标注 */}
                {item.confidence != null ? (
                  <div className={s.panoCardConf}
                    style={{ color: isActive ? color : 'rgba(255,255,255,0.5)' }}>
                    {(item.confidence * 100).toFixed(0)}%
                  </div>
                ) : (
                  <div className={s.panoCardConf}
                    style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 500 }}>
                    补充视角
                  </div>
                )}

                {/* 时间戳 */}
                {item.timestamp && (
                  <div className={s.panoCardTs}>{fmtTs(item.timestamp)}</div>
                )}

                {/* 方位角提示（仅激活卡片显示） */}
                {isActive && item.bearing_deg != null && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'rgba(0,0,0,0.65)', borderRadius: 4,
                    padding: '2px 6px', fontSize: 9,
                    color: 'rgba(255,255,255,0.5)',
                    fontFamily: "'SF Mono',monospace",
                  }}>
                    {item.bearing_deg.toFixed(0)}°
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 拖拽提示 */}
      <div className={s.panoDragHint}>
        <svg width="18" height="10" viewBox="0 0 36 12" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 6h32M2 6l5-4M2 6l5 4M34 6l-5-4M34 6l-5 4"/>
        </svg>
        拖拽旋转查看多角度证据 · {n} 个观测视角
      </div>

      {/* 进度点 */}
      {n > 1 && (
        <div className={s.panoDots}>
          {evidence.map((_, i) => (
            <div
              key={i}
              className={s.panoDot}
              data-active={i === activeIdx ? 'true' : 'false'}
              style={{ background: i === activeIdx ? color : 'rgba(255,255,255,0.18)', transform: i === activeIdx ? 'scale(1.5)' : 'scale(1)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 来源构成甜甜圈 ────────────────────────────────────────────────────────────
function SourceDonut({ sourceStats }) {
  const entries = Object.entries(sourceStats)

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(8,12,26,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e5e7eb', fontSize: 11 },
      formatter: p => `${p.name}: ${p.value} 条 (${p.percent}%)`,
    },
    series: [{
      type: 'pie',
      radius: ['50%', '76%'],
      center: ['50%', '50%'],
      data: entries.map(([src, st]) => ({
        name:      (SOURCE_META[src] || SOURCE_META.unknown).label,
        value:     st.count,
        itemStyle: { color: (SOURCE_META[src] || SOURCE_META.unknown).color },
      })),
      label: { show: false },
      labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 5, label: { show: false } },
    }],
  }), [sourceStats]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={s.donutSection}>
      <div className={s.sectionTitle}>数据来源构成</div>
      <div className={s.donutRow}>
        <ReactECharts option={option} style={{ width: 110, height: 110, flexShrink: 0 }} notMerge />
        <div className={s.donutLegend}>
          {entries.map(([src, st]) => {
            const meta = SOURCE_META[src] || SOURCE_META.unknown
            return (
              <div key={src} className={s.legendItem}>
                <div className={s.legendDot} style={{ background: meta.color }} />
                <span className={s.legendLabel}>{meta.label}</span>
                <span className={s.legendCount}>{st.count}条</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── 置信度提升对比 ────────────────────────────────────────────────────────────
function ConfBoost({ data, color }) {
  const { source_stats, fused_confidence, max_individual_conf, boost } = data
  const entries = Object.entries(source_stats)

  // 各来源颜色列表（按顺序取）
  const srcColors = entries.map(([src]) => (SOURCE_META[src] || SOURCE_META.unknown).color)

  return (
    <div className={s.boostSection}>
      <div className={s.sectionTitle}>融合置信度提升</div>

      <div className={s.formula}>
        P<sub>融合</sub> = 1 − ∏(1−P<sub>i</sub>)
        {' = '}
        <strong style={{ color }}>{(fused_confidence * 100).toFixed(1)}%</strong>
        <span
          className={s.boostChipInline}
          style={{ color, borderColor: color + '55', background: color + '18' }}
        >
          +{(boost * 100).toFixed(1)}%
        </span>
      </div>

      <div className={s.barRows}>
        {/* 各来源最高置信度 */}
        {entries.map(([src, st], i) => (
          <div key={src} className={s.barRow}>
            <span className={s.barLabel}
              style={{ color: srcColors[i] + 'cc' }}>
              {(SOURCE_META[src] || SOURCE_META.unknown).label}
            </span>
            <div className={s.barTrack}>
              <div
                className={s.barFill}
                style={{ width: `${(st.max_conf * 100).toFixed(1)}%`, background: srcColors[i] + 'cc' }}
              />
            </div>
            <span className={s.barVal}>{(st.max_conf * 100).toFixed(1)}%</span>
          </div>
        ))}

        <div className={s.barDivider} />

        {/* 融合后 */}
        <div className={s.barRow}>
          <span className={s.barLabel} style={{ color, fontWeight: 700 }}>融合后</span>
          <div className={s.barTrack} style={{ border: `1px solid ${color}40` }}>
            <div
              className={s.barFill}
              style={{
                width: `${(fused_confidence * 100).toFixed(1)}%`,
                background: `linear-gradient(to right, ${color}cc, ${color})`,
              }}
            />
          </div>
          <span className={s.barVal} style={{ color, fontWeight: 700 }}>
            {(fused_confidence * 100).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function FusionModal({ recordId, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (recordId == null) return
    setLoading(true)
    setError('')
    setData(null)
    getClusterFusion(recordId)
      .then(setData)
      .catch(e => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [recordId])

  const color = data?.color_hex || '#3b82f6'

  return (
    <div className={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={s.modal}>

        {/* ── 头部 ── */}
        <div className={s.header} style={{ borderBottom: `3px solid ${color}` }}>
          <div className={s.headerLeft}>
            <span className={s.dot} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            <span className={s.title}>{data?.label_cn || '多源融合全景'}</span>
            {data && (
              <span className={s.subtitle}>
                {data.total} 个视角
                {data.cluster_id ? ` · #${data.cluster_id.slice(0, 6)}` : ''}
              </span>
            )}
          </div>
          <div className={s.headerTag}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            多源融合全景
          </div>
          <button className={s.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* ── 主体 ── */}
        <div className={s.body}>
          {loading && (
            <div className={s.center}>
              <div className={s.spinner} />
              <span>加载融合数据…</span>
            </div>
          )}

          {!loading && error && (
            <div className={s.center} style={{ color: '#ef4444' }}>{error}</div>
          )}

          {!loading && !error && data && (
            <>
              {/* 全景 3D 旋转查看器 */}
              <PanoramaRing evidence={data.evidence} color={color} />

              {/* 统计摘要行 */}
              <div className={s.statsRow}>
                <div className={s.statItem}>
                  <span className={s.statVal}>{data.total}</span>
                  <span className={s.statLabel}>观测记录</span>
                </div>
                <div className={s.statItem}>
                  <span className={s.statVal}>{Object.keys(data.source_stats).length}</span>
                  <span className={s.statLabel}>数据来源</span>
                </div>
                <div className={s.statItem}>
                  <span className={s.statVal} style={{ color }}>
                    {(data.fused_confidence * 100).toFixed(1)}%
                  </span>
                  <span className={s.statLabel}>融合置信度</span>
                </div>
                <div className={s.statItem}>
                  <span className={s.statVal}>{data.scatter_radius_m}m</span>
                  <span className={s.statLabel}>GPS 散布半径</span>
                </div>
              </div>

              {/* 双栏分析 */}
              <div className={s.analysisRow}>
                <SourceDonut sourceStats={data.source_stats} />
                <ConfBoost   data={data} color={color} />
              </div>

              {/* 底部说明 */}
              <div className={s.footerNote}>
                <span style={{ color, fontWeight: 600 }}>低精度多源代偿：</span>
                {' '}来自 {Object.keys(data.source_stats).length} 类数据源的 {data.total} 条观测记录经时空聚类融合，
                将单源最高 {(data.max_individual_conf * 100).toFixed(1)}% 的置信度提升至
                <strong style={{ color }}> {(data.fused_confidence * 100).toFixed(1)}%</strong>，
                等效代偿专业巡检车精度；GPS 散布半径 {data.scatter_radius_m}m 内的坐标误差已通过质心均值算法修正。
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
