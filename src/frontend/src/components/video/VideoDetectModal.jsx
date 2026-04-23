import { useState, useEffect, useRef } from 'react'
import s from './VideoDetectModal.module.css'
import RegionCanvas from './RegionCanvas'
import { getFirstFrame, detectVideo, pollVideoStatus } from '../../api/client'

const STEPS = {
  SELECT:     'select',
  OCR:        'ocr',
  TIMED:      'timed',
  GPS:        'gps',
  PROCESSING: 'processing',
}

const TITLES = {
  select:     '选择检测模式',
  ocr:        'OCR 模式配置',
  timed:      '估算模式参数',
  gps:        'GPS 轨迹模式',
  processing: '正在处理…',
}

export default function VideoDetectModal({ file, onClose, onResults }) {
  const [step,         setStep]         = useState(STEPS.SELECT)
  const [mode,         setMode]         = useState('gps')  // 默认 GPS 模式
  const [intervalM,    setIntervalM]    = useState(5)
  const [speedKmh,     setSpeedKmh]     = useState(40)
  const [region,       setRegion]       = useState(null)
  const [gpsFile,      setGpsFile]      = useState(null)
  const [frame,        setFrame]        = useState(null)      // { frame_b64, width, height }
  const [frameLoading, setFrameLoading] = useState(false)
  const [error,        setError]        = useState('')
  const [pollLabel,    setPollLabel]    = useState('')        // 轮询阶段的状态文案
  const cancelledRef = useRef(false)                         // 取消轮询标志

  // 进入 OCR 配置步时自动预加载第一帧，让用户可直接标注速度区域
  useEffect(() => {
    if (step !== STEPS.OCR || frame) return
    setFrameLoading(true)
    getFirstFrame(file)
      .then(setFrame)
      .catch(() => { /* 帧加载失败不阻断流程 */ })
      .finally(() => setFrameLoading(false))
  }, [step, file, frame])

  // 轮询后台任务直到完成（无硬超时，视频长度决定耗时）
  async function waitForTask(taskId) {
    const INTERVAL_MS = 3000
    const startTime   = Date.now()

    while (!cancelledRef.current) {
      await new Promise(r => setTimeout(r, INTERVAL_MS))
      if (cancelledRef.current) return null   // 用户主动后台化

      let data
      try {
        data = await pollVideoStatus(taskId)
      } catch (e) {
        if (e.message.includes('不存在') || e.message.includes('404')) {
          throw new Error('服务已重启，任务已失效，请重新提交视频')
        }
        throw e
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const min = Math.floor(elapsed / 60)
      const sec = elapsed % 60
      const elapsedStr = min > 0 ? `${min}分${sec}秒` : `${sec}秒`

      if (data.status === 'done')   return data.result
      if (data.status === 'failed') throw new Error(data.error || '后台任务执行失败')

      const framesInfo = data.frames_done > 0 ? `已完成 ${data.frames_done} 帧 · ` : ''
      const phaseLabel = {
        ocr_loading:   'OCR 引擎加载中（首次启动约需3分钟）…',
        ocr_detecting: 'OCR 识别速度区域中…',
      }[data.phase] ?? null
      setPollLabel(
        data.status === 'processing'
          ? phaseLabel ?? `推理中… ${framesInfo}用时 ${elapsedStr}`
          : `排队等待… 已等待 ${elapsedStr}`
      )
    }
    return null
  }

  async function submit() {
    setError('')
    cancelledRef.current = false

    // GPS 模式需要先上传轨迹
    if (mode === 'gps' && !gpsFile) {
      setError('请上传 GPS 轨迹 JSON 文件')
      return
    }

    setStep(STEPS.PROCESSING)
    setPollLabel('提交任务中…')

    try {
      let gpsTrack = undefined
      if (mode === 'gps' && gpsFile) {
        const text = await gpsFile.text()
        const data = JSON.parse(text)
        gpsTrack = JSON.stringify(data.gps_track || data)
      }

      // 提交任务，后端立即返回 task_id
      const { task_id } = await detectVideo(file, {
        mode,
        intervalM,
        speedKmh,
        region: mode === 'ocr' ? region : undefined,
        gpsTrack,
      })

      setPollLabel('任务排队中…')

      // 轮询直到后台任务完成（null = 用户选择后台运行）
      const result = await waitForTask(task_id)
      if (result === null) return   // 用户主动后台化，结果已由后端写入数据库

      // OCR 自动识别失败 → 回到 OCR 步让用户框选
      if (result.status === 'ocr_failed') {
        setStep(STEPS.OCR)
        setError('未能自动识别速度区域，请在下方图像上手动框选速度数字所在位置后重新检测。')
        return
      }

      onResults(result.results)
      onClose()
    } catch (e) {
      setError(`推理失败：${e.message}`)
      if (mode === 'ocr') setStep(STEPS.OCR)
      else if (mode === 'gps') setStep(STEPS.GPS)
      else setStep(STEPS.TIMED)
    }
  }

  return (
    <div className={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={s.modal}>
        <div className={s.header}>
          <h2>{TITLES[step]}</h2>
          {step !== STEPS.PROCESSING && (
            <button className={s.closeBtn} onClick={onClose}>×</button>
          )}
        </div>

        {/* ── 模式选择 ───────────────────────────────────────── */}
        {step === STEPS.SELECT && (
          <>
            <div className={s.modeGrid}>
              <div
                className={`${s.modeCard} ${mode === 'gps' ? s.selected : ''}`}
                onClick={() => setMode('gps')}
              >
                <h4>GPS 轨迹模式</h4>
                <p>上传预先生成的轨迹 JSON 文件，按真实 GPS 位置抽帧。</p>
              </div>
              <div
                className={`${s.modeCard} ${mode === 'timed' ? s.selected : ''}`}
                onClick={() => setMode('timed')}
              >
                <h4>估算模式</h4>
                <p>手动输入大致车速，系统按时间间隔估算位置。无速度字幕时推荐使用。</p>
              </div>
              <div
                className={`${s.modeCard} ${mode === 'ocr' ? s.selected : ''}`}
                onClick={() => setMode('ocr')}
              >
                <h4>OCR 模式</h4>
                <p>读取视频速度字幕，按行驶距离均匀抽帧。字幕清晰时精度最高。</p>
              </div>
            </div>
            <div className={s.footer}>
              <button className={s.btnSecondary} onClick={onClose}>取消</button>
              <button
                className={s.btnPrimary}
                onClick={() => {
                  if (mode === 'ocr') setStep(STEPS.OCR)
                  else if (mode === 'gps') setStep(STEPS.GPS)
                  else setStep(STEPS.TIMED)
                }}
              >
                下一步
              </button>
            </div>
          </>
        )}

        {/* ── OCR 配置 + 可选区域标注 ────────────────────────── */}
        {step === STEPS.OCR && (
          <>
            <div className={s.field}>
              <label>抽帧间隔（米）</label>
              <input
                type="number" min="1" max="100"
                value={intervalM}
                onChange={e => setIntervalM(Number(e.target.value))}
              />
            </div>

            {/* 第一帧预览 + 可选速度区域框选 */}
            <div className={s.regionSection}>
              <div className={s.regionLabel}>
                速度区域
                {region ? (
                  <span className={s.regionChip}>
                    ✓ 已标注
                    <button
                      className={s.clearTag}
                      onClick={() => setRegion(null)}
                      title="清除标注区域"
                    >×</button>
                  </span>
                ) : (
                  <span className={s.regionHint}>可选 — 留空则自动识别</span>
                )}
              </div>

              {frameLoading && (
                <div className={s.frameLoading}>加载视频帧…</div>
              )}

              {!frameLoading && frame && (
                <RegionCanvas
                  frameB64={frame.frame_b64}
                  frameW={frame.width}
                  frameH={frame.height}
                  onRegion={setRegion}
                />
              )}

              {!frameLoading && !frame && (
                <div className={s.frameLoading} style={{ color: '#9ca3af' }}>
                  帧加载失败，将尝试自动识别速度区域
                </div>
              )}
            </div>

            {error && <div className={s.error}>{error}</div>}

            <div className={s.footer}>
              <button className={s.btnSecondary} onClick={() => setStep(STEPS.SELECT)}>
                上一步
              </button>
              <button
                className={s.btnSecondary}
                onClick={() => { setMode('timed'); setStep(STEPS.TIMED) }}
                title="切换到不依赖字幕的估算模式"
              >
                切换估算模式
              </button>
              <button className={s.btnPrimary} onClick={submit}>
                开始检测
              </button>
            </div>
          </>
        )}

        {/* ── GPS 轨迹模式 ────────────────────────────────────── */}
        {step === STEPS.GPS && (
          <>
            <div className={s.field}>
              <label>GPS 轨迹文件</label>
              <input
                type="file" accept=".json"
                onChange={e => setGpsFile(e.target.files[0])}
              />
              {gpsFile && (
                <div style={{ marginTop: '0.5rem', color: '#22c55e' }}>
                  ✓ 已选择: {gpsFile.name}
                </div>
              )}
            </div>
            <div className={s.field}>
              <label>抽帧间隔（米）</label>
              <input
                type="number" min="1" max="100"
                value={intervalM}
                onChange={e => setIntervalM(Number(e.target.value))}
              />
            </div>
            <div style={{ 
              padding: '1rem', 
              background: '#f0fdf4', 
              borderRadius: '0.5rem', 
              color: '#166534',
              fontSize: '0.9rem'
            }}>
              💡 提示: 如果没有轨迹文件，可以使用项目中的 <code>videotest/trajectory.json</code>
            </div>
            {error && <div className={s.error}>{error}</div>}
            <div className={s.footer}>
              <button className={s.btnSecondary} onClick={() => setStep(STEPS.SELECT)}>
                上一步
              </button>
              <button className={s.btnPrimary} onClick={submit}>
                开始检测
              </button>
            </div>
          </>
        )}

        {/* ── 估算模式参数 ────────────────────────────────────── */}
        {step === STEPS.TIMED && (
          <>
            <div className={s.field}>
              <label>大致车速（km/h）</label>
              <input
                type="number" min="1" max="200"
                value={speedKmh}
                onChange={e => setSpeedKmh(Number(e.target.value))}
              />
            </div>
            <div className={s.field}>
              <label>抽帧间隔（米）</label>
              <input
                type="number" min="1" max="100"
                value={intervalM}
                onChange={e => setIntervalM(Number(e.target.value))}
              />
              {speedKmh > 0 && intervalM > 0 && (
                <div className={s.preview}>
                  预计每 {(intervalM / (speedKmh / 3.6)).toFixed(1)} 秒抽一帧
                </div>
              )}
            </div>
            {error && <div className={s.error}>{error}</div>}
            <div className={s.footer}>
              <button className={s.btnSecondary} onClick={() => setStep(STEPS.SELECT)}>
                上一步
              </button>
              <button className={s.btnPrimary} onClick={submit}>
                开始检测
              </button>
            </div>
          </>
        )}

        {/* ── 处理中 ─────────────────────────────────────────── */}
        {step === STEPS.PROCESSING && (
          <div className={s.processing}>
            <div className={s.spinner} />
            <p>{pollLabel || '提交任务中…'}</p>
            <small>
              {mode === 'gps'
                ? 'GPS 模式正在根据轨迹按距离抽帧'
                : mode === 'timed'
                ? '估算模式已启用跳帧优化，速度较快'
                : 'OCR 模式正在识别速度字幕并按距离抽帧'}
            </small>
            <button
              className={s.bgBtn}
              onClick={() => { cancelledRef.current = true; onClose() }}
              title="关闭此窗口，任务继续在后台运行，结果将自动写入数据库"
            >
              后台运行
            </button>
            <div className={s.bgBtnNote}>关闭后结果将自动保存至数据库</div>
          </div>
        )}
      </div>
    </div>
  )
}
