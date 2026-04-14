import { useEffect, useRef } from 'react'
import s from './RegionCanvas.module.css'

export default function RegionCanvas({ frameB64, frameW, frameH, onRegion }) {
  const canvasRef = useRef(null)
  const ds = useRef({ drawing: false, done: false, sx: 0, sy: 0, cx: 0, cy: 0, img: null })

  useEffect(() => {
    if (!frameB64) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ds.current.img = img
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)
    }
    img.src = frameB64
  }, [frameB64])

  function toVideo(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.round((e.clientX - rect.left) * canvas.width / rect.width),
      y: Math.round((e.clientY - rect.top) * canvas.height / rect.height),
    }
  }

  function redraw() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { img, sx, sy, cx, cy, drawing, done } = ds.current
    if (!img) return
    ctx.drawImage(img, 0, 0)
    if (drawing || done) {
      const x = Math.min(sx, cx), y = Math.min(sy, cy)
      const w = Math.abs(cx - sx), h = Math.abs(cy - sy)
      ctx.strokeStyle = '#3E6AE1'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h)
      ctx.fillStyle = 'rgba(62,106,225,0.1)'; ctx.fillRect(x, y, w, h)
    }
  }

  function onDown(e) {
    const { x, y } = toVideo(e)
    ds.current = { ...ds.current, drawing: true, done: false, sx: x, sy: y, cx: x, cy: y }
    redraw()
  }
  function onMove(e) {
    if (!ds.current.drawing) return
    const { x, y } = toVideo(e)
    ds.current.cx = x; ds.current.cy = y; redraw()
  }
  function onUp() {
    if (!ds.current.drawing) return
    const { sx, sy, cx, cy } = ds.current
    ds.current.drawing = false; ds.current.done = true; redraw()
    const x1 = Math.min(sx, cx), y1 = Math.min(sy, cy)
    const x2 = Math.max(sx, cx), y2 = Math.max(sy, cy)
    if (x2 - x1 > 10 && y2 - y1 > 10) onRegion({ x1, y1, x2, y2 })
  }

  return (
    <div className={s.wrap}>
      <canvas ref={canvasRef} className={s.canvas}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} />
      <p className={s.hint}>在图像上拖拽框选速度数字所在区域</p>
    </div>
  )
}
