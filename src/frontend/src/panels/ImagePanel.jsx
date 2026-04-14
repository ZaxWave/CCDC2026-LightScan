import { useState } from 'react'
import s from './ImagePanel.module.css'
import UploadArea from '../components/UploadArea'
import ProgressBar from '../components/ProgressBar'
import StatsRow from '../components/StatsRow'
import ResultsGrid from '../components/ResultsGrid'
import { detectImages } from '../api/client'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp']

export default function ImagePanel() {
  const [items, setItems] = useState([])
  const [stats, setStats] = useState(null)
  const [progress, setProgress] = useState({ visible: false, text: '', pct: 0 })

  async function handleFiles(files) {
    const images = files.filter(f => ALLOWED.includes(f.type))
    if (!images.length) { alert('请上传图片文件（JPG / PNG / WEBP / BMP）'); return }
    setProgress({ visible: true, text: '正在上传并推理…', pct: 0 })
    let results
    try {
      results = await detectImages(images)
    } catch (e) {
      alert(`检测失败：${e.message}`)
      setProgress(p => ({ ...p, visible: false }))
      return
    }
    const newStats = stats ? { ...stats } : { total: 0, defects: 0, crack: 0, pothole: 0 }
    setStats(newStats)
    for (let i = 0; i < results.length; i++) {
      const item = results[i]
      setProgress({ visible: true, text: `渲染结果 (${i + 1}/${results.length})…`, pct: Math.round((i + 1) / results.length * 100) })
      setItems(prev => [...prev, item])
      newStats.total++
      if (item.detections.length > 0) newStats.defects++
      if (item.detections.some(d => d.tag === 'tag-crack'))   newStats.crack++
      if (item.detections.some(d => d.tag === 'tag-pothole')) newStats.pothole++
      setStats({ ...newStats })
      await new Promise(r => setTimeout(r, 40))
    }
    setProgress(p => ({ ...p, visible: false }))
  }

  return (
    <div className={s.panel}>
      <div className={s.sectionTitle}>上传文件</div>
      <UploadArea accept="image/*" multiple title="拖拽图片到此处" hint="支持 JPG、PNG、WEBP、BMP，单次最多 20 张" onFiles={handleFiles} />
      <ProgressBar visible={progress.visible} text={progress.text} pct={progress.pct} />
      <StatsRow stats={stats} />
      <div className={s.sectionTitle}>检测结果</div>
      <ResultsGrid items={items} />
    </div>
  )
}
