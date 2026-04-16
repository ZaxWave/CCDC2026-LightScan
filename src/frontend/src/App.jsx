import { useState } from 'react'
import './App.css'
import Nav from './components/Nav'
import Hero from './components/Hero'
import TabBar from './components/TabBar'
import ImagePanel from './panels/ImagePanel'
import VideoPanel from './panels/VideoPanel'
import MapPanel from './panels/MapPanel'
import MyRecordsPanel from './panels/MyRecordsPanel'
import LoginPanel from './panels/LoginPanel'
import { ToastProvider } from './context/ToastContext'

// 全屏面板（无 Hero、无 Footer）
const FULLSCREEN_TABS = ['map'];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'))
  const [tab, setTab] = useState('image')

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('login_time')
    setIsAuthenticated(false)
  }

  if (!isAuthenticated) {
    return <LoginPanel onLoginSuccess={() => setIsAuthenticated(true)} />
  }

  const isFullscreen = FULLSCREEN_TABS.includes(tab);

  return (
    <ToastProvider>
      <Nav onBackToDetect={() => setTab('image')} onLogout={handleLogout} onTabChange={setTab} />

      {!isFullscreen && (
        <Hero
          onImageClick={() => setTab('image')}
          onVideoClick={() => setTab('video')}
        />
      )}

      <TabBar active={tab} onChange={setTab} />

      <div className={isFullscreen ? `content-wrapper fullscreen-map` : 'content-wrapper'}>
        {tab === 'image'   && <ImagePanel />}
        {tab === 'video'   && <VideoPanel />}
        {tab === 'map'     && <MapPanel />}
        {tab === 'records' && <MyRecordsPanel />}
      </div>

      {tab !== 'map' && (
        <footer style={{
          borderTop: '1px solid var(--border)',
          padding: '32px',
          textAlign: 'center',
          fontSize: '12px',
          color: 'var(--muted)',
        }}>
          © 2026 LightScan Team · 第19届中国大学生计算机设计大赛
        </footer>
      )}
    </ToastProvider>
  )
}
