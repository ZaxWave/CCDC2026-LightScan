import s from './ResultCard.module.css'
export default function ResultCard({ item }) {
  const { filename, detections, image_b64, inference_ms } = item
  return (
    <div className={s.card}>
      <div className={s.thumb}>
        {image_b64 ? <img src={image_b64} alt={filename} /> : <span>无预览</span>}
      </div>
      <div className={s.info}>
        <div className={s.filename}>{filename}</div>
        <div className={s.tags}>
          {detections.length === 0
            ? <span className="tag tag-ok">正常</span>
            : detections.map((d, i) => <span key={i} className={`tag ${d.tag}`}>{d.label_cn}</span>)
          }
        </div>
        <div className={s.meta}>{detections.length > 0 && `${detections.length} 处病害 · `}{inference_ms != null && `${inference_ms} ms`}</div>
      </div>
    </div>
  )
}
