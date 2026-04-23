import s from './Nav.module.css'
import UserMenu from './UserMenu'
import NetStatus from './NetStatus'
import { useTaskCenter } from '../context/TaskContext'

export default function Nav({ onBackToDetect, onLogout, onTabChange, onTaskCenterClick }) {
  const { tasks } = useTaskCenter()
  const activeCount = tasks.filter(t => t.status === 'queued' || t.status === 'processing').length

  return (
    <nav className={s.nav}>
      <a className={s.brand} href="/">LIGHTSCAN</a>

      <div className={s.right}>
        <div className={s.links}>
          <a href="#" onClick={e => { e.preventDefault(); onBackToDetect?.() }}>检测</a>
          <a href="#" onClick={e => { e.preventDefault(); onTabChange?.('about') }}>关于</a>
        </div>
        <div className={s.divider} />
        <NetStatus />
        <div className={s.divider} />
        <button className={s.taskBtn} onClick={onTaskCenterClick} title="任务中心">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor"/>
            <rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor"/>
            <rect x="2" y="11.5" width="8" height="1.5" rx="0.75" fill="currentColor"/>
          </svg>
          {activeCount > 0 && <span className={s.badge}>{activeCount}</span>}
        </button>
        <div className={s.divider} />
        <UserMenu onLogout={onLogout} onNavigate={onTabChange} />
      </div>
    </nav>
  )
}
