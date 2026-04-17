/**
 * HeatmapControls.jsx
 * 热力图层管理 + 参数调节面板。
 * - 接管 AMap.HeatMap 实例的完整生命周期
 * - 提供渐变预设、热力半径、透明度三组控件
 * - visible=false 时自动隐藏热力图并收起面板
 */

import { useEffect, useRef, useState } from 'react'
import s from './HeatmapControls.module.css'

// 病害严重程度 → 热力权重
const HEAT_WEIGHT = { D40: 1.0, D20: 0.7, D10: 0.5, D00: 0.3 }

// 渐变预设
const PRESETS = {
  standard: {
    label: '标准',
    stops: { 0.3: '#4ade80', 0.55: '#facc15', 0.75: '#f97316', 1.0: '#ef4444' },
  },
  risk: {
    label: '风险等级',
    stops: { 0.2: '#38bdf8', 0.45: '#818cf8', 0.7: '#e879f9', 1.0: '#ef4444' },
  },
  density: {
    label: '密度分析',
    stops: { 0.0: '#1e3a5f', 0.35: '#2563eb', 0.65: '#93c5fd', 1.0: '#eff6ff' },
  },
}

export default function HeatmapControls({ mapInstance, records, visible }) {
  const heatmapRef = useRef(null)
  const [radius,  setRadius]  = useState(30)
  const [opacity, setOpacity] = useState(85)   // 0-100 整数，方便 range input
  const [preset,  setPreset]  = useState('standard')

  // ── 热力图创建 / 更新 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance || !window.AMap) return

    if (!visible) {
      heatmapRef.current?.hide()
      return
    }

    if (records.length === 0) return

    const heatData = records
      .filter(r => !isNaN(parseFloat(r?.lng)) && !isNaN(parseFloat(r?.lat)))
      .map(r => ({
        lng:   parseFloat(r.lng),
        lat:   parseFloat(r.lat),
        count: HEAT_WEIGHT[r.label] ?? 0.3,
      }))

    const gradient = PRESETS[preset].stops

    if (!heatmapRef.current) {
      heatmapRef.current = new window.AMap.HeatMap(mapInstance, {
        radius,
        opacity:  [0, opacity / 100],
        gradient,
        zooms:    [3, 18],
      })
    } else {
      heatmapRef.current.setOptions({
        radius,
        opacity:  [0, opacity / 100],
        gradient,
      })
    }

    heatmapRef.current.setDataSet({ data: heatData, max: 1.0 })
    heatmapRef.current.show()
  }, [mapInstance, records, visible, radius, opacity, preset])

  // ── 卸载时隐藏热力图 ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => { heatmapRef.current?.hide() }
  }, [])

  if (!visible) return null

  return (
    <div className={s.panel}>
      <div className={s.title}>热力图参数</div>

      {/* 渐变预设 */}
      <div className={s.presets}>
        {Object.entries(PRESETS).map(([key, val]) => (
          <button
            key={key}
            className={`${s.preset} ${preset === key ? s.active : ''}`}
            onClick={() => setPreset(key)}
          >
            {val.label}
          </button>
        ))}
      </div>

      {/* 热力半径 */}
      <div className={s.row}>
        <span className={s.label}>热力半径</span>
        <input
          type="range" min="10" max="60" step="2" value={radius}
          onChange={e => setRadius(Number(e.target.value))}
          className={s.slider}
        />
        <span className={s.val}>{radius} px</span>
      </div>

      {/* 最大透明度 */}
      <div className={s.row}>
        <span className={s.label}>透明度</span>
        <input
          type="range" min="30" max="100" step="5" value={opacity}
          onChange={e => setOpacity(Number(e.target.value))}
          className={s.slider}
        />
        <span className={s.val}>{opacity}%</span>
      </div>
    </div>
  )
}
