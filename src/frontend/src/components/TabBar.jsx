import s from './TabBar.module.css'
const TABS = [{ id: 'image', label: '图片检测' }, { id: 'video', label: '视频检测' }]
export default function TabBar({ active, onChange }) {
  return (
    <div className={s.bar}>
      {TABS.map(t => (
        <button key={t.id} className={`${s.tab} ${active === t.id ? s.active : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
