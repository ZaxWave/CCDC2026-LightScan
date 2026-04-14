import s from './ProgressBar.module.css'
export default function ProgressBar({ text, pct, visible }) {
  if (!visible) return null
  return (
    <div className={s.wrap}>
      <div className={s.labels}><span>{text}</span><span>{pct}%</span></div>
      <div className={s.track}><div className={s.fill} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}
