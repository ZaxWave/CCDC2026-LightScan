/**
 * MapPicker.jsx
 * 轻量地图选点弹窗：点击地图设置坐标，确认后返回 {lat, lng}（GCJ-02）。
 */
import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'

const AMAP_KEY           = import.meta.env.VITE_AMAP_KEY
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE

export default function MapPicker({ onConfirm, onClose }) {
  const mapRef     = useRef(null)
  const mapObjRef  = useRef(null)
  const markerRef  = useRef(null)
  const [picked, setPicked] = useState(null)   // {lat, lng}
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE }
    AMapLoader.load({
      key:     AMAP_KEY,
      version: '2.0',
    }).then(AMap => {
      const map = new AMap.Map(mapRef.current, {
        zoom:      13,
        center:    [114.3826, 30.5128],
        mapStyle:  'amap://styles/darkblue',
      })
      mapObjRef.current = map
      setLoading(false)

      map.on('click', (e) => {
        const { lng, lat } = e.lnglat
        setPicked({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) })

        if (markerRef.current) map.remove(markerRef.current)
        const m = new AMap.Marker({ position: [lng, lat] })
        map.add(m)
        markerRef.current = m
      })
    }).catch(() => setLoading(false))

    return () => {
      mapObjRef.current?.destroy()
    }
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#0d1117', borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        overflow: 'hidden', width: 560, maxWidth: '95vw',
        boxShadow: '0 24px 64px rgba(0,0,0,0.8)',
      }} onClick={e => e.stopPropagation()}>

        {/* 标题栏 */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f3f4f6' }}>
            选择拍摄位置
          </span>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            {picked
              ? `${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}`
              : '点击地图选点'}
          </span>
        </div>

        {/* 地图区 */}
        <div style={{ position: 'relative', height: 360 }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          {loading && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.4)', fontSize: 13,
            }}>加载地图中…</div>
          )}
        </div>

        {/* 底部操作 */}
        <div style={{
          padding: '12px 18px', display: 'flex', gap: 10, justifyContent: 'flex-end',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          <button onClick={onClose} style={{
            padding: '7px 18px', borderRadius: 6, fontSize: 13,
            background: 'none', border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
          }}>取消</button>
          <button
            disabled={!picked}
            onClick={() => picked && onConfirm(picked)}
            style={{
              padding: '7px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              background: picked ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${picked ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)'}`,
              color: picked ? '#4ade80' : 'rgba(255,255,255,0.2)',
              cursor: picked ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >确认位置</button>
        </div>
      </div>
    </div>
  )
}
