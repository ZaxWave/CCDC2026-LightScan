import { useState } from 'react'
import s from './ResultCard.module.css'

function fmtTime(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch { return iso }
}

export default function ResultCard({ item }) {
  const { filename, detections, image_b64, inference_ms, timestamp } = item
  const [isZoomed, setIsZoomed] = useState(false)

  return (
    <>
      <div className={s.card}>
        <div 
          className={s.thumb} 
          onClick={() => image_b64 && setIsZoomed(true)}
        >
          {image_b64 ? (
            <>
              <img src={image_b64} alt={filename} />
              <div className={s.zoomHint}>点击放大</div>
            </>
          ) : (
            <span>无预览</span>
          )}
        </div>
        <div className={s.info}>
          <div className={s.filename}>{filename}</div>
          <div className={s.tags}>
            {detections.length === 0
              ? (
                <span 
                  className="tag" 
                  style={{ backgroundColor: '#e6f9ee', color: '#1a8045' }}
                >
                  正常
                </span>
              )
              : detections.map((d, i) => (
                  <span 
                    key={i} 
                    className="tag" 
                    style={{ 
                      backgroundColor: d.color || '#eeeeee', 
                      color: '#000',
                      fontWeight: 'bold',
                      border: 'none'
                    }}
                  >
                    {d.label_cn} {d.conf}
                  </span>
                ))
            }
          </div>
          <div className={s.meta}>
            {detections.length > 0 && `${detections.length} 处病害 · `}
            {inference_ms != null && `${inference_ms} ms`}
            {fmtTime(timestamp) && ` · ${fmtTime(timestamp)}`}
          </div>
        </div>
      </div>

      {isZoomed && (
        <div className={s.overlay} onClick={() => setIsZoomed(false)}>
          <div className={s.modalContent} onClick={(e) => e.stopPropagation()}>
            <img src={image_b64} alt={filename} />
            <div className={s.closeBtn} onClick={() => setIsZoomed(false)}>×</div>
          </div>
        </div>
      )}
    </>
  )
}