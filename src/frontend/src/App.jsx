import { useState } from 'react'
import Nav from './components/Nav'
import Hero from './components/Hero'
import TabBar from './components/TabBar'
import ImagePanel from './panels/ImagePanel'
import VideoPanel from './panels/VideoPanel'

export default function App() {
  const [tab, setTab] = useState('image')
  return (
    <>
      <Nav />
      <Hero onImageClick={() => setTab('image')} onVideoClick={() => setTab('video')} />
      <TabBar active={tab} onChange={setTab} />
      {tab === 'image' ? <ImagePanel /> : <VideoPanel />}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '32px', textAlign: 'center', fontSize: '12px', color: 'var(--muted)' }}>
        © 2026 LightScan Team · 第19届中国大学生计算机设计大赛
      </footer>
    </>
  )
}
