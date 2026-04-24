import { useState, useRef, useEffect } from 'react'
import s from './ImagePanel.module.css'
import UploadArea from '../components/UploadArea'
import ProgressBar from '../components/ProgressBar'
import StatsRow from '../components/StatsRow'
import ResultsGrid from '../components/ResultsGrid'
import { detectImages } from '../api/client'
import { useToast } from '../context/ToastContext'
import { useNetwork } from '../context/NetworkContext'
import { saveOfflineTask } from '../utils/offlineDB'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp']

export default function ImagePanel() {
  const [items,    setItems]    = useState([])
  const [stats,    setStats]    = useState(null)
  const [progress, setProgress] = useState({ visible: false, text: '', pct: 0 })
  const toast = useToast()
  const { isOnline, refreshCount } = useNetwork()
  const uploadRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        uploadRef.current?.open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleFiles(files) {
    const images = files.filter(f => ALLOWED.includes(f.type))
    if (!images.length) {
      alert('请上传图片文件（JPG / PNG / WEBP / BMP）')
      return
    }

    // ── 断网路径：缓存到 IndexedDB ──────────────────────────────
    if (!isOnline) {
      setProgress({ visible: true, text: '网络不可用，正在缓存到本地…', pct: 60 })
      try {
        await saveOfflineTask(images)
        await refreshCount()
        setProgress(p => ({ ...p, visible: false }))
        toast(
          `已将 ${images.length} 张图片缓存到本地（共 ${images.reduce((a, f) => a + f.size, 0) > 1024 * 1024
            ? (images.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(1) + ' MB'
            : Math.round(images.reduce((a, f) => a + f.size, 0) / 1024) + ' KB'
          }），联网后将自动同步`,
          'warn',
          7000,
        )
      } catch (e) {
        setProgress(p => ({ ...p, visible: false }))
        toast(`本地缓存失败：${e.message}，请检查浏览器存储权限`, 'danger', 6000)
      }
      return
    }

    // ── 联网路径：正常检测流程 ──────────────────────────────────
    setProgress({ visible: true, text: '正在上传并推理…', pct: 0 })
    let results
    try {
      results = await detectImages(images)
    } catch (e) {
      setProgress(p => ({ ...p, visible: false }))
      // 上传过程中网络中断：提示是否缓存
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

    for (let i = 0; i < results.length; i++) {
      const item = results[i]
      setProgress({
        visible: true,
        text: `渲染结果 (${i + 1}/${results.length})…`,
        pct: Math.round((i + 1) / results.length * 100),
      })
      setItems(prev => [...prev, item])
      newStats.total++
      newStats.defects += item.detections.length

      let hasD40 = false
      let d40Confidence = 0
      item.detections.forEach(d => {
        if (['D00', 'D10', 'D20'].includes(d.label)) {
          newStats.crack++
        } else if (d.label === 'D40') {
          newStats.pothole++
          hasD40 = true
          if (d.confidence > d40Confidence) {
            d40Confidence = d.confidence
          }
        }
      })

      if (hasD40) {
        toast(
          `⚠ 高风险病害：检测到坑槽（D40），置信度 ${
            (d40Confidence * 100).toFixed(1)
          }%，请及时处置！`,
          'danger',
          6000,
        )
      }

      setStats({ ...newStats })
      await new Promise(r => setTimeout(r, 40))
    }

    setProgress(p => ({ ...p, visible: false }))
    // 同步完成后刷新待传计数（以防刚才有离线任务被自动同步）
    refreshCount()
  }

  return (
    <div className={s.panel}>
      <div className={s.sectionTitle}>上传文件</div>

      {/* 断网提示横幅 */}
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

      <UploadArea
        ref={uploadRef}
        accept="image/*"
        multiple
        title="拖拽图片到此处"
        hint="支持 JPG、PNG、WEBP、BMP，单次最多 20 张 · Ctrl+Enter 快速选择"
        onFiles={handleFiles}
      />
      <ProgressBar visible={progress.visible} text={progress.text} pct={progress.pct} />
      <StatsRow stats={stats} />
      <div className={s.sectionTitle}>检测结果</div>
      <ResultsGrid items={items} />
    </div>
  )
}
