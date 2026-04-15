import { useState } from 'react'
import s from './VideoPanel.module.css'
import UploadArea from '../components/UploadArea'
import StatsRow from '../components/StatsRow'
import ResultsGrid from '../components/ResultsGrid'
import VideoDetectModal from '../components/video/VideoDetectModal'

export default function VideoPanel() {
  const [file, setFile] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [items, setItems] = useState([])
  const [stats, setStats] = useState(null)

  function handleFiles(files) {
    const video = files.find(f => f.type === 'video/mp4')
    if (!video) { alert('请上传 MP4 格式的视频文件'); return }
    setFile(video); setModalOpen(true)
  }

  function handleResults(results) {
    if (!results?.length) { alert('视频处理完成，但未检出任何帧'); return }
    const st = { total: 0, defects: 0, crack: 0, pothole: 0 }
    results.forEach(item => {
      st.total++
      st.defects += item.detections.length
      item.detections.forEach(d => {
        if (['D00', 'D10', 'D20'].includes(d.label)) st.crack++
        else if (d.label === 'D40') st.pothole++
      })
    })
    setItems(results); setStats(st)
  }

  return (
    <div className={s.panel}>
      <div className={s.sectionTitle}>上传视频</div>
      <UploadArea accept="video/mp4" multiple={false} title="拖拽视频到此处" hint="支持 MP4 格式，最大 500 MB" onFiles={handleFiles} />
      <StatsRow stats={stats} />
      <div className={s.sectionTitle}>检测结果</div>
      <ResultsGrid items={items} />
      {modalOpen && file && <VideoDetectModal file={file} onClose={() => setModalOpen(false)} onResults={handleResults} />}
    </div>
  )
}
