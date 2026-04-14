import { useState } from 'react'
import s from './VideoDetectModal.module.css'
import RegionCanvas from './RegionCanvas'
import { getFirstFrame, detectVideo } from '../../api/client'

const STEPS = { SELECT: 'select', OCR: 'ocr', TIMED: 'timed', REGION: 'region', PROCESSING: 'processing' }
const TITLES = { select: '选择检测模式', ocr: 'OCR 模式参数', timed: '估算模式参数', region: '框选速度区域', processing: '正在处理…' }

export default function VideoDetectModal({ file, onClose, onResults }) {
  const [step, setStep] = useState(STEPS.SELECT)
  const [mode, setMode] = useState('ocr')
  const [intervalM, setIntervalM] = useState(5)
  const [speedKmh, setSpeedKmh] = useState(40)
  const [region, setRegion] = useState(null)
  const [frame, setFrame] = useState(null)
  const [error, setError] = useState('')

  async function submit(forceRegion) {
    setError(''); setStep(STEPS.PROCESSING)
    try {
      const data = await detectVideo(file, { mode, intervalM, speedKmh, region: forceRegion || region })
      if (data.status === 'ocr_failed') {
        setStep(STEPS.REGION)
        try { setFrame(await getFirstFrame(file)) } catch (e) { setError(`获取第一帧失败：${e.message}`) }
        return
      }
      onResults(data.results); onClose()
    } catch (e) {
      setError(`推理失败：${e.message}`)
      setStep(mode === 'ocr' ? STEPS.OCR : STEPS.TIMED)
    }
  }

  return (
    <div className={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={s.modal}>
        <div className={s.header}>
          <h2>{TITLES[step]}</h2>
          {step !== STEPS.PROCESSING && <button className={s.closeBtn} onClick={onClose}>×</button>}
        </div>

        {step === STEPS.SELECT && <>
          <div className={s.modeGrid}>
            <div className={`${s.modeCard} ${mode === 'ocr' ? s.selected : ''}`} onClick={() => setMode('ocr')}>
              <h4>OCR 模式</h4><p>自动识别视频左下角速度字幕，按行驶距离均匀抽帧</p>
            </div>
            <div className={`${s.modeCard} ${mode === 'timed' ? s.selected : ''}`} onClick={() => setMode('timed')}>
              <h4>估算模式</h4><p>手动输入大致车速，系统按时间间隔估算抽帧位置</p>
            </div>
          </div>
          <div className={s.footer}>
            <button className={s.btnSecondary} onClick={onClose}>取消</button>
            <button className={s.btnPrimary} onClick={() => setStep(mode === 'ocr' ? STEPS.OCR : STEPS.TIMED)}>下一步</button>
          </div>
        </>}

        {step === STEPS.OCR && <>
          <div className={s.field}>
            <label>抽帧间隔（米）</label>
            <input type="number" min="1" max="100" value={intervalM} onChange={e => setIntervalM(Number(e.target.value))} />
          </div>
          {error && <div className={s.error}>{error}</div>}
          <div className={s.footer}>
            <button className={s.btnSecondary} onClick={() => setStep(STEPS.SELECT)}>上一步</button>
            <button className={s.btnPrimary} onClick={() => submit()}>开始检测</button>
          </div>
        </>}

        {step === STEPS.TIMED && <>
          <div className={s.field}>
            <label>大致车速（km/h）</label>
            <input type="number" min="1" max="200" value={speedKmh} onChange={e => setSpeedKmh(Number(e.target.value))} />
          </div>
          <div className={s.field}>
            <label>抽帧间隔（米）</label>
            <input type="number" min="1" max="100" value={intervalM} onChange={e => setIntervalM(Number(e.target.value))} />
            {speedKmh > 0 && intervalM > 0 && (
              <div className={s.preview}>预计每 {(intervalM / (speedKmh / 3.6)).toFixed(1)} 秒抽一帧</div>
            )}
          </div>
          {error && <div className={s.error}>{error}</div>}
          <div className={s.footer}>
            <button className={s.btnSecondary} onClick={() => setStep(STEPS.SELECT)}>上一步</button>
            <button className={s.btnPrimary} onClick={() => submit()}>开始检测</button>
          </div>
        </>}

        {step === STEPS.REGION && <>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>自动检测未能找到速度文字，请手动框选速度数字所在区域。</p>
          {frame
            ? <RegionCanvas frameB64={frame.frame_b64} frameW={frame.width} frameH={frame.height} onRegion={r => setRegion(r)} />
            : <p style={{ color: 'var(--muted)', fontSize: 13 }}>正在加载第一帧…</p>
          }
          {error && <div className={s.error}>{error}</div>}
          <div className={s.footer}>
            <button className={s.btnSecondary} onClick={onClose}>取消</button>
            <button className={s.btnPrimary} disabled={!region} onClick={() => submit(region)}>确认并重新检测</button>
          </div>
        </>}

        {step === STEPS.PROCESSING && (
          <div className={s.processing}>
            <div className={s.spinner} />
            <p>正在处理视频，请稍候…</p>
            <small>视频较长时可能需要数分钟</small>
          </div>
        )}
      </div>
    </div>
  )
}
