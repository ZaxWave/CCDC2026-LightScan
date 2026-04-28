/**
 * ClusterLayer.jsx
 * 管理地图上所有病害标记点的生命周期。
 * - 按 cluster_id 分组，同一聚类只放一个 Marker，弹窗显示该聚类全部病害
 * - 按工单状态着色，支持脉冲/暗化/普通三种筛选外观
 * - visible=false 时整体隐藏（热力图模式）
 */

import { useEffect, useRef } from 'react'
import { buildClusterInfoWindowHtml, statusColor } from './MarkerInfoWindow'

// ── 标记内容生成器 ──────────────────────────────────────────────────────────
function mkContent(color, mode, count) {
  const badge = count > 1
    ? `<div style="
        position:absolute;top:-6px;right:-6px;
        background:#3b82f6;color:#fff;
        font-size:9px;font-weight:700;line-height:1;
        border-radius:8px;padding:2px 4px;
        border:1px solid rgba(255,255,255,0.4);
      ">${count}</div>`
    : ''

  if (mode === 'pulse') {
    return `<div style="position:relative;width:18px;height:18px;">
      <div style="
        background:${color};width:18px;height:18px;border-radius:50%;
        border:2px solid #fff;box-shadow:0 0 15px ${color};
        animation:ls-pulse 1s ease-in-out infinite;cursor:pointer;
      "></div>${badge}</div>`
  }
  if (mode === 'dim') {
    return `<div style="position:relative;width:10px;height:10px;">
      <div style="
        background:${color};width:10px;height:10px;border-radius:50%;
        border:1px solid rgba(255,255,255,0.2);opacity:0.25;cursor:pointer;
      "></div></div>`
  }
  return `<div style="position:relative;width:14px;height:14px;">
    <div style="
      background:${color};width:14px;height:14px;border-radius:50%;
      border:2px solid #fff;box-shadow:0 0 15px ${color};cursor:pointer;
    "></div>${badge}</div>`
}

// ── 聚类分组工具 ────────────────────────────────────────────────────────────
function groupByCluster(records) {
  const map = new Map()
  for (const r of records) {
    const key = r.cluster_id || `solo_${r.id}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return map
}

/** 从聚类内所有记录中挑出"代表色"和"代表位置" */
function clusterMeta(items) {
  // 代表记录：优先取有 label_cn 的最新一条
  const withLabel = items.filter(r => r.label_cn)
  const rep = withLabel.length > 0
    ? withLabel.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0]
    : items[0]
  // 代表色：所有有色记录里取第一个
  const colored = items.find(r => r.color_hex) || rep
  return { rep, color: statusColor(colored), lat: rep.lat, lng: rep.lng }
}

// ── 组件 ────────────────────────────────────────────────────────────────────
export default function ClusterLayer({
  mapInstance,
  records,
  selectedType,
  visible,
  onShowTimeline,
  onShowFusion,
}) {
  const infoWinRef        = useRef(null)
  const markersRef        = useRef([])   // [{marker, repItem, allItems}]
  const onShowTimelineRef = useRef(onShowTimeline)
  const onShowFusionRef   = useRef(onShowFusion)

  useEffect(() => { onShowTimelineRef.current = onShowTimeline }, [onShowTimeline])
  useEffect(() => { onShowFusionRef.current   = onShowFusion   }, [onShowFusion])

  // ── 重建所有标记 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance) return

    markersRef.current.forEach(({ marker }) => mapInstance.remove(marker))
    markersRef.current = []
    if (infoWinRef.current) { infoWinRef.current.close(); infoWinRef.current = null }

    if (records.length === 0) return

    const infoWindow = new window.AMap.InfoWindow({
      isCustom: true,
      autoMove: true,
      offset: new window.AMap.Pixel(0, -22),
    })
    infoWinRef.current = infoWindow

    window.__lsCloseInfoWindow = () => infoWindow.close()
    window.__lsShowTimeline    = (id) => { infoWindow.close(); onShowTimelineRef.current(id) }
    window.__lsShowFusion      = (id) => { infoWindow.close(); onShowFusionRef.current?.(id) }
    window.__lsDispatchOrder   = window.__lsDispatchOrder || (() => {})

    mapInstance.on('click', () => infoWindow.close())

    const clusters = groupByCluster(records)
    const toAdd = []

    for (const [, clusterItems] of clusters) {
      const { rep, color, lat, lng } = clusterMeta(clusterItems)
      const parsedLng = parseFloat(lng)
      const parsedLat = parseFloat(lat)
      if (isNaN(parsedLng) || isNaN(parsedLat) || parsedLng === 0 || parsedLat === 0) continue

      // 只展示有病害标签的记录（排除纯补充视角）
      const labeled = clusterItems.filter(r => r.label_cn)
      if (labeled.length === 0) continue

      const mode = !selectedType ? 'normal'
        : labeled.some(r => r.label_cn === selectedType) ? 'pulse' : 'dim'

      const marker = new window.AMap.Marker({
        position: [parsedLng, parsedLat],
        title:    labeled.map(r => r.label_cn).join(' / '),
        content:  mkContent(color, mode, labeled.length),
      })

      marker.on('click', () => {
        infoWindow.setContent(buildClusterInfoWindowHtml(labeled, clusterItems))
        infoWindow.open(mapInstance, marker.getPosition())
      })

      if (!visible) marker.hide()
      markersRef.current.push({ marker, repItem: rep, allItems: clusterItems, labeled })
      toAdd.push(marker)
    }

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
    markersRef.current.forEach(({ marker, repItem, labeled }) => {
      const color = statusColor(repItem)
      const count = labeled?.length || 1
      if (!selectedType) {
        marker.setContent(mkContent(color, 'normal', count))
      } else if (labeled?.some(r => r.label_cn === selectedType)) {
        marker.setContent(mkContent(color, 'pulse', count))
      } else {
        marker.setContent(mkContent(color, 'dim', count))
      }
    })
  }, [selectedType])

  return null
}
