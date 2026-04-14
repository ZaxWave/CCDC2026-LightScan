import s from './ResultsGrid.module.css'
import ResultCard from './ResultCard'
export default function ResultsGrid({ items }) {
  if (!items.length) {
    return (
      <div className={s.empty}>
        <svg className={s.emptyIcon} width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect x="6" y="6" width="36" height="36" rx="4" stroke="#393C41" strokeWidth="2"/>
          <path d="M6 18H42M18 18V42" stroke="#393C41" strokeWidth="2"/>
        </svg>
        <p>暂无结果，上传图像后自动展示检测结果</p>
      </div>
    )
  }
  return <div className={s.grid}>{items.map((item, i) => <ResultCard key={i} item={item} />)}</div>
}
