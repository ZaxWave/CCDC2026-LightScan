import { useState, useRef, useEffect } from 'react'
import s from './ImagePanel.module.css'
import UploadArea from '../components/UploadArea'
import ProgressBar from '../components/ProgressBar'
import StatsRow from '../components/StatsRow'
import ResultsGrid from '../components/ResultsGrid'
import FusionModal from '../components/map/FusionModal'
import MapPicker from '../components/MapPicker'
import { detectImages } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useNetwork } from '../context/NetworkContext'
import { saveOfflineTask } from '../utils/offlineDB'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp']

// 四类数据来源，与后端 VALID_SOURCE_TYPES 对应
const SOURCE_OPTIONS = [
  {
    value: 'dashcam',
    label: '行车记录仪',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8l5 3v4l-5 3V8z"/>
      </svg>
    ),
    color: '#8b5cf6',
  },
  {
    value: 'mobile',
    label: '手机拍摄',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
      </svg>
    ),
    color: '#22c55e',
  },
  {
    value: 'camera',
    label: '监控摄像头',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
      </svg>
    ),
    color: '#f97316',
  },
  {
    value: 'drone',
    label: '无人机',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L8 6H5l-2 2 3 3-1 1 3 3 1-1 3 3 2-2v-3l4-4-2-2h-3l-4-4z"/><circle cx="12" cy="12" r="2"/>
      </svg>
    ),
    color: '#06b6d4',
  },
]

export default function ImagePanel() {
  const [items,          setItems]          = useState([])
  const [stats,          setStats]          = useState(null)
  const [progress,       setProgress]       = useState({ visible: false, text: '', pct: 0 })
  const [sourceType,     setSourceType]     = useState('mobile')
  const [fusionClusters, setFusionClusters] = useState([])
  const [fusionRecordId, setFusionRecordId] = useState(null)
  // 手动/浏览器定位坐标（整批共享）
  const [gpsOverride,    setGpsOverride]    = useState(null)   // {lat, lng} | null
  const [gpsLocating,    setGpsLocating]    = useState(false)
  const [showMapPicker,  setShowMapPicker]  = useState(false)

  const toast = useToast()
  const { isOnline, refreshCount } = useNetwork()
  const uploadRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        uploadRef.current?.open()
      }
      if (e.key === 'Escape' && fusionRecordId != null) {
        setFusionRecordId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fusionRecordId])

  async function handleFiles(files) {
    const images = files.filter(f => ALLOWED.includes(f.type))
    if (!images.length) {
      alert('请上传图片文件（JPG / PNG / WEBP / BMP）')
      return
    }

    // ── 断网路径 ──────────────────────────────────────────────
    if (!isOnline) {
      setProgress({ visible: true, text: '网络不可用，正在缓存到本地…', pct: 60 })
      try {
        await saveOfflineTask(images)
        await refreshCount()
        setProgress(p => ({ ...p, visible: false }))
        toast(
          `已将 ${images.length} 张图片缓存到本地（${images.reduce((a, f) => a + f.size, 0) > 1048576
            ? (images.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1) + ' MB'
            : Math.round(images.reduce((a, f) => a + f.size, 0) / 1024) + ' KB'
          }），联网后将自动同步`,
          'warn', 7000,
        )
      } catch (e) {
        setProgress(p => ({ ...p, visible: false }))
        toast(`本地缓存失败：${e.message}，请检查浏览器存储权限`, 'danger', 6000)
      }
      return
    }

    // ── 联网路径 ──────────────────────────────────────────────
    setProgress({ visible: true, text: '正在上传并推理…', pct: 0 })
    let results
    try {
      results = await detectImages(images, sourceType, gpsOverride)
    } catch (e) {
      setProgress(p => ({ ...p, visible: false }))
      if (!navigator.onLine) {
        try {
          await saveOfflineTask(images)
          await refreshCount()
          toast('上传中途断网，已自动缓存到本地，恢复后将重传', 'warn', 7000)
        } catch {
          toast(`检测失败且缓存出错：${e.message}`, 'danger', 6000)
        }
      } else {
        alert(`检测失败：${e.message}`)
      }
      return
    }

    const newStats = stats ? { ...stats } : { total: 0, defects: 0, crack: 0, pothole: 0 }
    setStats(newStats)

    // 收集本批次产生的多视角聚类（cluster_count ≥ 2）
    // 优先取 detections 中 cluster_count 最大的条目作代表；
    // 同批次上传 N 张图片时，N≥2 就一定产生 cluster_count≥2 的 cluster。
    const newClusterMap = {}
    for (const item of results) {
      for (const det of (item.detections || [])) {
        if (det.cluster_id) {
          const prev = newClusterMap[det.cluster_id]
          if (!prev || det.cluster_count > prev.cluster_count) {
            newClusterMap[det.cluster_id] = {
              record_id:     det.record_id,
              cluster_id:    det.cluster_id,
              cluster_count: det.cluster_count,
              label_cn:      det.label_cn,
              color:         det.color || '#ef4444',
            }
          }
        }
      }
    }
    // 移除 cluster_count=1 的条目（单张图、未与任何图片聚类）
    const multiClusters = Object.values(newClusterMap).filter(c => c.cluster_count > 1)
    if (multiClusters.length > 0) {
      setFusionClusters(prev => {
        const merged = Object.fromEntries(prev.map(c => [c.cluster_id, c]))
        multiClusters.forEach(c => { merged[c.cluster_id] = c })
        return Object.values(merged)
      })
    }

    for (let i = 0; i < results.length; i++) {
      const item = results[i]
      setProgress({
        visible: true,
        text:    `渲染结果 (${i + 1}/${results.length})…`,
        pct:     Math.round((i + 1) / results.length * 100),
      })
      setItems(prev => [...prev, item])
      newStats.total++
      newStats.defects += (item.detections || []).length

      let hasD40 = false
      let d40Conf = 0
      ;(item.detections || []).forEach(d => {
        if (['D00', 'D10', 'D20'].includes(d.label)) newStats.crack++
        else if (d.label === 'D40') {
          newStats.pothole++
          hasD40 = true
          if ((d.conf || 0) > d40Conf) d40Conf = d.conf || 0
        }
      })

      if (hasD40) {
        toast(
          `⚠ 高风险病害：检测到坑槽（D40），置信度 ${(d40Conf * 100).toFixed(1)}%，请及时处置！`,
          'danger', 6000,
        )
      }
      setStats({ ...newStats })
      await new Promise(r => setTimeout(r, 40))
    }

    setProgress(p => ({ ...p, visible: false }))
    refreshCount()
  }

  function exportReport() {
    const rows = [['文件名', '病害类型', '置信度', '推理耗时(ms)', '聚类视角数']]
    for (const item of items) {
      if (!item.detections?.length) {
        rows.push([item.filename, '正常', '', item.inference_ms ?? '', ''])
      } else {
        for (const d of item.detections) {
          rows.push([
            item.filename,
            `${d.label_cn}(${d.label})`,
            d.conf,
            item.inference_ms ?? '',
            d.cluster_count ?? 1,
          ])
        }
      }
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), {
      href: url,
      download: `lightscan_report_${new Date().toISOString().slice(0, 10)}.csv`,
    }).click()
    URL.revokeObjectURL(url)
  }

  const activeSrc = SOURCE_OPTIONS.find(o => o.value === sourceType)

  return (
    <div className={s.panel}>
      <div className={s.sectionTitle}>上传文件</div>

      {/* 断网提示 */}
      {!isOnline && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', marginBottom: 12,
          background: 'rgba(217,48,37,0.05)',
          border: '1px solid rgba(217,48,37,0.2)',
          borderLeft: '3px solid #D93025',
          fontSize: 13, color: '#D93025',
        }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span>当前处于<strong>离线状态</strong>，上传的图片将缓存在本地，恢复网络后自动同步</span>
        </div>
      )}

      {/* ── 数据来源选择器 ── */}
      <div className={s.sourceRow}>
        <span className={s.sourceLabel}>数据来源</span>
        <div className={s.sourcePills}>
          {SOURCE_OPTIONS.map(opt => {
            const active = sourceType === opt.value
            return (
              <button
                key={opt.value}
                className={s.sourcePill}
                onClick={() => setSourceType(opt.value)}
                style={{
                  borderColor: active ? opt.color : 'var(--border)',
                  background:  active ? opt.color + '20' : 'transparent',
                  color:       active ? opt.color : 'var(--muted)',
                }}
              >
                <span style={{ color: active ? opt.color : 'var(--muted)', opacity: active ? 1 : 0.5 }}>
                  {opt.icon}
                </span>
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 位置信息行 ── */}
      <div className={s.gpsRow}>
        <span className={s.sourceLabel}>拍摄位置</span>
        {gpsOverride ? (
          <div className={s.gpsActive}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            </svg>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>
              {gpsOverride.lat.toFixed(5)}, {gpsOverride.lng.toFixed(5)}
            </span>
            <button className={s.gpsClearBtn} onClick={() => setGpsOverride(null)}>清除</button>
          </div>
        ) : (
          <div className={s.gpsInactive}>
            <button className={s.gpsPickBtn} onClick={() => setShowMapPicker(true)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              选择位置
            </button>
            <button
              className={s.gpsLocateBtn}
              disabled={gpsLocating}
              onClick={() => {
                if (!navigator.geolocation) { alert('浏览器不支持定位'); return }
                setGpsLocating(true)
                navigator.geolocation.getCurrentPosition(
                  pos => {
                    setGpsOverride({ lat: pos.coords.latitude, lng: pos.coords.longitude })
                    setGpsLocating(false)
                  },
                  err => {
                    alert(`定位失败：${err.message}`)
                    setGpsLocating(false)
                  },
                  { timeout: 8000 }
                )
              }}
            >
              {gpsLocating ? <span className={s.gpsSpinner} /> : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                </svg>
              )}
              获取当前位置
            </button>
          </div>
        )}
      </div>

      <UploadArea
        ref={uploadRef}
        accept="image/*"
        multiple
        title="拖拽图片到此处"
        hint={`来源：${activeSrc?.label || '手机拍摄'} · 支持 JPG、PNG、WEBP、BMP，单次最多 20 张 · Ctrl+Enter 快速选择`}
        onFiles={handleFiles}
      />
      <ProgressBar visible={progress.visible} text={progress.text} pct={progress.pct} />
      <StatsRow stats={stats} />

      {/* ── 多源融合发现卡 ── */}
      {fusionClusters.length > 0 && (
        <div className={s.fusionCard}>
          <div className={s.fusionCardHeader}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span className={s.fusionCardTitle}>多源融合发现</span>
            <span className={s.fusionCardSub}>
              {fusionClusters.length} 处病害已与历史记录自动聚类，可查看多角度全景
            </span>
          </div>
          <div className={s.fusionClusterList}>
            {fusionClusters.map(c => (
              <div key={c.cluster_id} className={s.fusionClusterRow}>
                <span className={s.fusionClusterDot} style={{ background: c.color }} />
                <span className={s.fusionClusterLabel} style={{ color: c.color }}>
                  {c.label_cn || '病害'}
                </span>
                <span className={s.fusionClusterCount}>
                  {c.cluster_count} 个视角
                </span>
                <button
                  className={s.fusionViewBtn}
                  onClick={() => setFusionRecordId(c.record_id)}
                >
                  查看全景
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 0 12px' }}>
          <button
            onClick={exportReport}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              background: 'var(--ash)', border: '1px solid var(--border)',
              color: 'var(--muted)', cursor: 'pointer', letterSpacing: '0.04em',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--blue)'; e.currentTarget.style.color = 'var(--blue)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            导出 CSV 报告
          </button>
        </div>
      )}

      <div className={s.sectionTitle}>检测结果</div>
      <ResultsGrid items={items} />

      {/* 多源融合全景弹窗 */}
      {fusionRecordId != null && (
        <FusionModal
          recordId={fusionRecordId}
          onClose={() => setFusionRecordId(null)}
        />
      )}
      {showMapPicker && (
        <MapPicker
          onConfirm={pos => { setGpsOverride(pos); setShowMapPicker(false) }}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </div>
  )
}
