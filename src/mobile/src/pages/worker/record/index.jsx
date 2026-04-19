import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useRef } from 'react'
import { uploadVideo } from '../../../api/detect'
import CameraRecorder from './CameraRecorder'
import styles from './index.module.scss'

const INTERVAL_METERS = 5
const GPS_POLL_MS = 3000
const ENV = Taro.getEnv()
const IS_WEAPP = ENV === 'WEAPP'

function haversineM(p1, p2) {
  const R = 6371000
  const lat1 = (p1.lat * Math.PI) / 180
  const lat2 = (p2.lat * Math.PI) / 180
  const dlat = ((p2.lat - p1.lat) * Math.PI) / 180
  const dlng = ((p2.lng - p1.lng) * Math.PI) / 180
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeTotalDist(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1], points[i])
  }
  return total
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function WorkerRecord() {
  const [phase,        setPhase]        = useState('idle')
  const [gpsPoints,    setGpsPoints]    = useState([])
  const [videoPath,    setVideoPath]    = useState('')
  const [duration,     setDuration]     = useState(0)
  const [totalDist,    setTotalDist]    = useState(0)
  const [currentSpeed, setCurrentSpeed] = useState(0)
  const [uploadMsg,    setUploadMsg]    = useState('')

  const recorderRef  = useRef(null)
  const gpsTimerRef  = useRef(null)
  const timerRef     = useRef(null)
  const startTimeRef = useRef(0)
  const gpsPointsRef = useRef([])

  const goBack = () => Taro.navigateBack()

  // GPS 轮询：getLocation 普通小程序完全支持
  const startGps = () => {
    gpsPointsRef.current = []
    setGpsPoints([])
    setTotalDist(0)
    setCurrentSpeed(0)

    const poll = () => {
      Taro.getLocation({ type: 'gcj02' })
        .then(res => {
          const speedKmh = Math.max(0, res.speed ?? 0) * 3.6
          const point = {
            lat:          res.latitude,
            lng:          res.longitude,
            speed_kmh:    speedKmh,
            timestamp_ms: Date.now(),
          }
          const next = [...gpsPointsRef.current, point]
          gpsPointsRef.current = next
          setGpsPoints(next)
          setTotalDist(computeTotalDist(next))
          setCurrentSpeed(speedKmh)
        })
        .catch(() => {})
    }

    poll()
    gpsTimerRef.current = setInterval(poll, GPS_POLL_MS)
  }

  const stopGps = () => {
    clearInterval(gpsTimerRef.current)
    gpsTimerRef.current = null
  }

  const startRecording = () => {
    if (!IS_WEAPP) {
      Taro.showToast({ title: '录像功能仅支持微信小程序', icon: 'none', duration: 3000 })
      return
    }

    recorderRef.current.start(
      () => {
        startGps()
        startTimeRef.current = Date.now()
        timerRef.current = setInterval(() => {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
        }, 1000)
        setPhase('recording')
      },
      (msg) => {
        Taro.showToast({ title: `启动失败：${msg}`, icon: 'none', duration: 4000 })
      },
    )
  }

  const stopRecording = () => {
    recorderRef.current.stop(
      (tempVideoPath) => {
        clearInterval(timerRef.current)
        stopGps()
        setVideoPath(tempVideoPath)
        setPhase('done')
      },
      (msg) => {
        Taro.showToast({ title: `停止失败：${msg}`, icon: 'none', duration: 4000 })
      },
    )
  }

  const doUpload = async (pts) => {
    setPhase('uploading')
    setUploadMsg('上传中...')
    try {
      const result = await uploadVideo(videoPath, pts, INTERVAL_METERS)
      const frameCount  = result?.total_frames ?? 0
      const defectCount = (result?.results ?? []).reduce(
        (acc, r) => acc + (r.detections?.length ?? 0), 0
      )
      setUploadMsg(`检测完成：${frameCount} 帧，发现 ${defectCount} 处病害`)
      setTimeout(() => Taro.navigateBack(), 3000)
    } catch (e) {
      Taro.showToast({ title: `上传失败：${e.message}`, icon: 'none', duration: 4000 })
      setPhase('done')
    }
  }

  const handleUpload = () => {
    const pts = gpsPointsRef.current
    if (pts.length === 0) {
      Taro.showModal({
        title: '无 GPS 数据',
        content: '未采集到 GPS 轨迹，病害定位不可用，是否继续上传？',
        success: r => { if (r.confirm) doUpload([]) }
      })
      return
    }
    doUpload(pts)
  }

  const resetRecording = () => {
    gpsPointsRef.current = []
    setPhase('idle')
    setGpsPoints([])
    setVideoPath('')
    setDuration(0)
    setTotalDist(0)
    setCurrentSpeed(0)
    setUploadMsg('')
  }

  const estimatedFrames = Math.max(0, Math.floor(totalDist / INTERVAL_METERS))
  const showCamera = phase === 'idle' || phase === 'recording'

  return (
    <View className={styles.page}>

      <View className={styles.header}>
        <View className={styles.backBtn} onClick={goBack}>
          <Text className={styles.backIcon}>‹</Text>
        </View>
        <Text className={styles.title}>巡检录像</Text>
        {phase === 'recording'
          ? <View className={styles.recBadge}>
              <View className={styles.recDot} />
              <Text className={styles.recText}>REC</Text>
            </View>
          : <View className={styles.headerRight} />
        }
      </View>

      {/* Camera 始终挂载到录像结束，避免 context 失效 */}
      {showCamera && <CameraRecorder ref={recorderRef} />}

      {/* 录制中实时数据叠加 */}
      {phase === 'recording' && (
        <View className={styles.statsOverlay}>
          <View className={styles.statCell}>
            <Text className={styles.statVal}>{fmtTime(duration)}</Text>
            <Text className={styles.statLbl}>时长</Text>
          </View>
          <View className={styles.statDivider} />
          <View className={styles.statCell}>
            <Text className={styles.statVal}>{currentSpeed.toFixed(1)}</Text>
            <Text className={styles.statLbl}>km/h</Text>
          </View>
          <View className={styles.statDivider} />
          <View className={styles.statCell}>
            <Text className={styles.statVal}>{totalDist.toFixed(0)}</Text>
            <Text className={styles.statLbl}>m 里程</Text>
          </View>
          <View className={styles.statDivider} />
          <View className={styles.statCell}>
            <Text className={styles.statVal}>{gpsPoints.length}</Text>
            <Text className={styles.statLbl}>GPS 点</Text>
          </View>
        </View>
      )}

      {/* 录像完成摘要 */}
      {(phase === 'done' || phase === 'uploading') && (
        <View className={styles.summaryWrap}>
          <Text className={styles.summaryTitle}>录像完成</Text>
          <View className={styles.summaryGrid}>
            <View className={styles.summaryCell}>
              <Text className={styles.summaryVal}>{fmtTime(duration)}</Text>
              <Text className={styles.summaryLbl}>时长</Text>
            </View>
            <View className={styles.summaryCell}>
              <Text className={styles.summaryVal}>{gpsPoints.length}</Text>
              <Text className={styles.summaryLbl}>GPS 点</Text>
            </View>
            <View className={styles.summaryCell}>
              <Text className={styles.summaryVal}>{totalDist.toFixed(0)} m</Text>
              <Text className={styles.summaryLbl}>里程</Text>
            </View>
            <View className={styles.summaryCell}>
              <Text className={styles.summaryVal}>~{estimatedFrames}</Text>
              <Text className={styles.summaryLbl}>预计抽帧</Text>
            </View>
          </View>
          <Text className={styles.summaryNote}>
            间隔 {INTERVAL_METERS}m 抽帧 · GPS 精确定位
          </Text>
          {phase === 'uploading' && uploadMsg && (
            <Text className={styles.uploadStatus}>{uploadMsg}</Text>
          )}
        </View>
      )}

      <View className={styles.controls}>
        {phase === 'idle' && (
          <>
            <Text className={styles.landscapeTip}>建议横屏录制，效果更佳</Text>
            <View className={styles.startBtn} onClick={startRecording}>
              <Text className={styles.startBtnText}>开始录像</Text>
            </View>
            <Text className={styles.hint}>间隔 {INTERVAL_METERS}m 抽帧 · 录制时自动记录 GPS 轨迹</Text>
          </>
        )}

        {phase === 'recording' && (
          <View className={styles.stopBtn} onClick={stopRecording}>
            <View className={styles.stopIcon} />
            <Text className={styles.stopBtnText}>停止录像</Text>
          </View>
        )}

        {phase === 'done' && (
          <View className={styles.actionRow}>
            <View className={styles.resetBtn} onClick={resetRecording}>
              <Text className={styles.resetBtnText}>重新录制</Text>
            </View>
            <View className={styles.uploadBtn} onClick={handleUpload}>
              <Text className={styles.uploadBtnText}>上传检测</Text>
            </View>
          </View>
        )}

        {phase === 'uploading' && (
          <View className={styles.uploadingRow}>
            <Text className={styles.uploadingText}>正在上传并推理，请勿关闭...</Text>
          </View>
        )}
      </View>

    </View>
  )
}
