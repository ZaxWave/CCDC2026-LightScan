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
import AboutPanel from './panels/AboutPanel'
import DashboardPanel from './panels/DashboardPanel'
import TaskCenterDrawer from './components/TaskCenterDrawer'
import { ToastProvider } from './context/ToastContext'
import { NetworkProvider } from './context/NetworkContext'
import { TaskProvider } from './context/TaskContext'

const FULLSCREEN_TABS = ['map', 'dashboard'];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'))
  const [tab, setTab] = useState('image')
  const [prevTab, setPrevTab] = useState('image')
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false)

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('login_time')
    setIsAuthenticated(false)
  }

  const handleTabChange = (newTab) => {
    if (tab !== newTab) {
      setPrevTab(tab)
    }
    setTab(newTab)
  }

  if (!isAuthenticated) {
    return <LoginPanel onLoginSuccess={() => setIsAuthenticated(true)} />
  }

  const isFullscreen = FULLSCREEN_TABS.includes(tab);
  const showHero = !isFullscreen && tab !== 'about';

  return (
    <ToastProvider>
      <NetworkProvider>
      <TaskProvider>
      <Nav
        onBackToDetect={() => handleTabChange('image')}
        onLogout={handleLogout}
        onTabChange={handleTabChange}
        onTaskCenterClick={() => setTaskDrawerOpen(true)}
      />

      {/* 只有在检测页面（image, video, records）才显示 Hero */}
      {showHero && (
        <Hero
          onImageClick={() => handleTabChange('image')}
          onVideoClick={() => handleTabChange('video')}
        />
      )}

      {/* 只有不是关于页面时，才显示 TabBar */}
      {tab !== 'about' && <TabBar active={tab} onChange={handleTabChange} />}

      <div className={isFullscreen ? `content-wrapper fullscreen-map` : 'content-wrapper'}>
        {tab === 'image'   && <ImagePanel />}
        {tab === 'video'   && <VideoPanel />}
        {tab === 'map'     && <MapPanel onBackToDetect={() => handleTabChange('image')} />}
        {tab === 'records' && <MyRecordsPanel />}
        {tab === 'about'   && <AboutPanel />}
        {tab === 'dashboard' && <DashboardPanel onExit={() => handleTabChange(prevTab)} />}
      </div>

      {tab !== 'map' && tab !== 'dashboard' && (
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

      <TaskCenterDrawer
        open={taskDrawerOpen}
        onClose={() => setTaskDrawerOpen(false)}
        onViewRecords={() => handleTabChange('records')}
      />
      </TaskProvider>
      </NetworkProvider>
    </ToastProvider>
  )
}