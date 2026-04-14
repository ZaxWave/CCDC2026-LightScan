import s from './StatsRow.module.css'
export default function StatsRow({ stats }) {
  if (!stats) return null
  return (
    <div className={s.row}>
      <div className={s.card}><div className={s.val}>{stats.total}</div><div className={s.label}>已检测图像</div></div>
      <div className={s.card}><div className={`${s.val} ${s.blue}`}>{stats.defects}</div><div className={s.label}>检出病害</div></div>
      <div className={s.card}><div className={s.val}>{stats.crack}</div><div className={s.label}>裂缝</div></div>
      <div className={s.card}><div className={s.val}>{stats.pothole}</div><div className={s.label}>坑槽</div></div>
    </div>
  )
}
