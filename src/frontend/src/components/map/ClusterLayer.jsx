/**
 * ClusterLayer.jsx
 * 管理地图上所有病害标记点的生命周期。
 * - 按工单状态着色，支持脉冲/暗化/普通三种筛选外观
 * - 点击标记 → 弹出 InfoWindow（含演变时间轴按钮）
 * - visible=false 时整体隐藏（热力图模式）
 *
 * 注意：不依赖 AMap.MarkerClusterer，使用原生 AMap.Marker 以保证
 * 跨版本兼容性。标记聚合的视觉呈现交由后端空间聚类逻辑负责。
 */

import { useEffect, useRef } from 'react'
import { buildInfoWindowHtml, statusColor } from './MarkerInfoWindow'

// ── 标记内容生成器 ──────────────────────────────────────────────────────────
function mkContent(color, mode) {
  if (mode === 'pulse') {
    return `<div style="
      background:${color};width:18px;height:18px;border-radius:50%;
      border:2px solid #fff;box-shadow:0 0 15px ${color};
      animation:ls-pulse 1s ease-in-out infinite;cursor:pointer;
    "></div>`
  }
  if (mode === 'dim') {
    return `<div style="
      background:${color};width:9px;height:9px;border-radius:50%;
      border:1px solid rgba(255,255,255,0.2);opacity:0.2;cursor:pointer;
    "></div>`
  }
  return `<div style="
    background:${color};width:14px;height:14px;border-radius:50%;
    border:2px solid #fff;box-shadow:0 0 15px ${color};cursor:pointer;
  "></div>`
}

// ── 组件 ────────────────────────────────────────────────────────────────────
export default function ClusterLayer({
  mapInstance,
  records,
  selectedType,
  visible,
  onShowTimeline,
}) {
  const infoWinRef        = useRef(null)
  const markersRef        = useRef([])          // [{marker, item}]
  const onShowTimelineRef = useRef(onShowTimeline)

  // 始终指向最新回调，避免 InfoWindow 闭包旧值问题
  useEffect(() => { onShowTimelineRef.current = onShowTimeline }, [onShowTimeline])

  // ── 重建所有标记 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance) return

    // 清理上次的标记与 InfoWindow
    markersRef.current.forEach(({ marker }) => mapInstance.remove(marker))
    markersRef.current = []
    if (infoWinRef.current) { infoWinRef.current.close(); infoWinRef.current = null }

    if (records.length === 0) return

    // 共享一个 InfoWindow 实例
    const infoWindow = new window.AMap.InfoWindow({
      isCustom: true,
      autoMove: true,
      offset: new window.AMap.Pixel(0, -22),
    })
    infoWinRef.current = infoWindow

    // 挂到 window，供 InfoWindow 内 HTML 的 onclick 调用
    window.__lsCloseInfoWindow = () => infoWindow.close()
    window.__lsShowTimeline    = (id) => {
      infoWindow.close()
      onShowTimelineRef.current(id)
    }

    // 点击地图空白处关闭
    mapInstance.on('click', () => infoWindow.close())

    const toAdd = []
    for (const item of records) {
      const lng = parseFloat(item?.lng)
      const lat = parseFloat(item?.lat)
      if (isNaN(lng) || isNaN(lat) || lng === 0 || lat === 0) continue

      const color  = statusColor(item)
      const mode   = !selectedType ? 'normal'
                   : item.label_cn === selectedType ? 'pulse' : 'dim'
      const marker = new window.AMap.Marker({
        position: [lng, lat],
        title:    item.label_cn || '病害',
        content:  mkContent(color, mode),
      })

      marker.on('click', () => {
        infoWindow.setContent(buildInfoWindowHtml(item))
        infoWindow.open(mapInstance, marker.getPosition())
      })

      if (!visible) marker.hide()
      markersRef.current.push({ marker, item })
      toAdd.push(marker)
    }

    // 批量添加，减少重绘次数
    mapInstance.add(toAdd)

    return () => {
      toAdd.forEach(m => mapInstance.remove(m))
      markersRef.current = []
    }
  }, [mapInstance, records]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 热力图 / 散点切换 ─────────────────────────────────────────────────────
  useEffect(() => {
    markersRef.current.forEach(({ marker }) => {
      visible ? marker.show() : marker.hide()
    })
  }, [visible])

  // ── 按病害类型筛选更新外观 ────────────────────────────────────────────────
  useEffect(() => {
    markersRef.current.forEach(({ marker, item }) => {
      const color = statusColor(item)
      if (!selectedType)                       marker.setContent(mkContent(color, 'normal'))
      else if (item.label_cn === selectedType) marker.setContent(mkContent(color, 'pulse'))
      else                                     marker.setContent(mkContent(color, 'dim'))
    })
  }, [selectedType])

  return null
}
