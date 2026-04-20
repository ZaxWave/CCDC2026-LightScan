import { useState, useRef, useEffect } from 'react'
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import * as Location from 'expo-location'
import * as ScreenOrientation from 'expo-screen-orientation'
import { uploadVideo } from '../../api/detect'
import { computeTotalDist, fmtTime } from '../../utils/geo'

const INTERVAL_METERS = 5
const GPS_OPTS = { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 1 }

export default function RecordScreen({ navigation }) {
  const [camPerm, requestCamPerm] = useCameraPermissions()
  const [micPerm, requestMicPerm] = useMicrophonePermissions()
  const [hasLocPerm, setHasLocPerm] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [duration, setDuration] = useState(0)
  const [currentSpeed, setCurrentSpeed] = useState(0)
  const [totalDist, setTotalDist] = useState(0)
  const [gpsCount, setGpsCount] = useState(0)
  const [videoUri, setVideoUri] = useState('')
  const [uploadMsg, setUploadMsg] = useState('')
  const [isLandscape, setIsLandscape] = useState(false)
  const [promptDismissed, setPromptDismissed] = useState(false)

  const cameraRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const locationSubRef = useRef(null)
  const gpsPointsRef = useRef([])

  // 请求权限
  useEffect(() => {
    async function requestAllPermissions() {
      console.log('[perm] Requesting permissions...')

      // 直接请求权限，不管当前状态
      if (!camPerm?.granted) {
        const camResult = await requestCamPerm()
        console.log('[perm] Camera permission:', camResult?.granted)
      }

      if (!micPerm?.granted) {
        const micResult = await requestMicPerm()
        console.log('[perm] Mic permission:', micResult?.granted)
      }

      // 请求位置权限
      const { status } = await Location.requestForegroundPermissionsAsync()
      setHasLocPerm(status === 'granted')
    }

    requestAllPermissions()
  }, [])

  // 设置屏幕方向监听
  useEffect(() => {
    const oriSub = ScreenOrientation.addOrientationChangeListener(evt => {
      const o = evt.orientationInfo.orientation
      setIsLandscape(
        o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
      )
    })

    return () => {
      ScreenOrientation.removeOrientationChangeListener(oriSub)
      clearInterval(timerRef.current)
      locationSubRef.current?.remove()
    }
  }, [])

  const startGps = async () => {
    if (!hasLocPerm) return
    gpsPointsRef.current = []
    setGpsCount(0)
    setTotalDist(0)
    setCurrentSpeed(0)

    locationSubRef.current = await Location.watchPositionAsync(GPS_OPTS, loc => {
      const speedKmh = Math.max(0, (loc.coords.speed ?? 0) * 3.6)
      const point = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        speed_kmh: speedKmh,
        timestamp_ms: loc.timestamp,
      }
      const next = [...gpsPointsRef.current, point]
      gpsPointsRef.current = next
      setGpsCount(next.length)
      setTotalDist(computeTotalDist(next))
      setCurrentSpeed(speedKmh)
    })
  }

  const stopGps = () => {
    locationSubRef.current?.remove()
    locationSubRef.current = null
  }

  const startRecording = async () => {
    console.log('[record] Start recording...')

    if (!cameraRef.current) {
      Alert.alert('错误', '摄像头未初始化')
      return
    }
    if (!camPerm?.granted || !micPerm?.granted) {
      Alert.alert('权限不足', '请授予摄像头和麦克风权限')
      return
    }

    try {
      setPhase('recording')
      await startGps()
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)

      console.log('[record] Calling recordAsync...')
      const videoPromise = cameraRef.current.recordAsync({})
      const result = await videoPromise
      console.log('[record] Record result:', result)

      clearInterval(timerRef.current)
      stopGps()
      setVideoUri(result.uri)
      setPhase('done')
    } catch (e) {
      console.log('[record] ERROR:', e.message)
      console.log('[record] Error stack:', e.stack)
      clearInterval(timerRef.current)
      stopGps()
      setPhase('idle')
      if (!e.message?.includes('cancelled')) {
        Alert.alert('录像失败', e.message)
      }
    }
  }

  const stopRecording = () => {
    cameraRef.current?.stopRecording()
  }

  const doUpload = () => {
    const pts = gpsPointsRef.current
    if (pts.length === 0) {
      Alert.alert('无 GPS 数据', '未采集到 GPS 轨迹，是否继续上传？', [
        { text: '取消', style: 'cancel' },
        { text: '继续', onPress: () => runUpload([]) },
      ])
      return
    }
    runUpload(pts)
  }

  const runUpload = async (pts) => {
    setPhase('uploading')
    setUploadMsg('上传中...')
    try {
      const result = await uploadVideo(videoUri, pts, INTERVAL_METERS)
      const frameCount = result?.total_frames ?? 0
      const defectCount = (result?.results ?? []).reduce((a, r) => a + (r.detections?.length ?? 0), 0)
      setUploadMsg(`检测完成：${frameCount} 帧，发现 ${defectCount} 处病害`)
      setTimeout(() => navigation.goBack(), 3000)
    } catch (e) {
      Alert.alert('上传失败', e.message)
      setPhase('done')
    }
  }

  const resetRecording = () => {
    gpsPointsRef.current = []
    setPhase('idle')
    setVideoUri('')
    setDuration(0)
    setTotalDist(0)
    setCurrentSpeed(0)
    setGpsCount(0)
    setUploadMsg('')
    setPromptDismissed(false)
  }

  const estimatedFrames = Math.max(0, Math.floor(totalDist / INTERVAL_METERS))
  const showCamera = phase === 'idle' || phase === 'recording'
  const showLandscapePrompt = showCamera && phase === 'idle' && !isLandscape && !promptDismissed

  if (!camPerm) {
    return <View style={s.page}><Text style={s.permText}>请求权限中...</Text></View>
  }
  if (!camPerm.granted) {
    return (
      <SafeAreaView style={s.page}>
        <Text style={s.permText}>需要摄像头权限才能使用巡检录像</Text>
        <TouchableOpacity style={s.permBtn} onPress={requestCamPerm} activeOpacity={0.8}>
          <Text style={s.permBtnText}>授权摄像头</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  return (
    <View style={s.page}>
      {/* Camera — stays mounted throughout idle+recording to keep context alive */}
      {showCamera && (
        <CameraView
          ref={cameraRef}
          style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
          facing="back"
          active={true}
          onCameraReady={() => {
            console.log('[camera] Camera ready!')
          }}
          onMountError={(e) => {
            console.log('[camera] Mount error:', e.message)
            Alert.alert('摄像头错误', e.message)
          }}
        />
      )}

      {/* Header */}
      <SafeAreaView style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.title}>巡检录像</Text>
        {phase === 'recording'
          ? <View style={s.recBadge}><View style={s.recDot} /><Text style={s.recText}>REC</Text></View>
          : <View style={{ width: 60 }} />
        }
      </SafeAreaView>



      {/* Landscape prompt — user can dismiss and record in portrait */}
      {showLandscapePrompt && (
        <View style={s.landscapeOverlay}>
          <Text style={s.landscapeTitle}>建议横屏录制</Text>
          <Text style={s.landscapeDesc}>横屏可获得更宽的视野，道路病害检测效果更佳</Text>
          <TouchableOpacity style={s.landscapeDismiss} onPress={() => setPromptDismissed(true)} activeOpacity={0.7}>
            <Text style={s.landscapeDismissText}>竖屏继续</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Real-time stats overlay during recording */}
      {phase === 'recording' && (
        <View style={s.statsOverlay}>
          <View style={s.statCell}>
            <Text style={s.statVal}>{fmtTime(duration)}</Text>
            <Text style={s.statLbl}>时长</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCell}>
            <Text style={s.statVal}>{currentSpeed.toFixed(1)}</Text>
            <Text style={s.statLbl}>km/h</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCell}>
            <Text style={s.statVal}>{totalDist.toFixed(0)}</Text>
            <Text style={s.statLbl}>m 里程</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statCell}>
            <Text style={s.statVal}>{gpsCount}</Text>
            <Text style={s.statLbl}>GPS 点</Text>
          </View>
        </View>
      )}

      {/* Summary after recording */}
      {(phase === 'done' || phase === 'uploading') && (
        <View style={s.summaryWrap}>
          <Text style={s.summaryTitle}>录像完成</Text>
          <View style={s.summaryGrid}>
            <View style={s.summaryCell}>
              <Text style={s.summaryVal}>{fmtTime(duration)}</Text>
              <Text style={s.summaryLbl}>时长</Text>
            </View>
            <View style={s.summaryCell}>
              <Text style={s.summaryVal}>{gpsCount}</Text>
              <Text style={s.summaryLbl}>GPS 点</Text>
            </View>
            <View style={s.summaryCell}>
              <Text style={s.summaryVal}>{totalDist.toFixed(0)} m</Text>
              <Text style={s.summaryLbl}>里程</Text>
            </View>
            <View style={s.summaryCell}>
              <Text style={s.summaryVal}>~{estimatedFrames}</Text>
              <Text style={s.summaryLbl}>预计抽帧</Text>
            </View>
          </View>
          <Text style={s.summaryNote}>间隔 {INTERVAL_METERS}m 抽帧 · GPS 精确定位</Text>
          {uploadMsg ? <Text style={s.uploadStatus}>{uploadMsg}</Text> : null}
        </View>
      )}

      {/* Controls */}
      <View style={s.controls}>
        {phase === 'idle' && (
          <TouchableOpacity style={s.startBtn} onPress={startRecording} activeOpacity={0.8}>
            <Text style={s.startBtnText}>开始录像</Text>
          </TouchableOpacity>
        )}
        {phase === 'recording' && (
          <TouchableOpacity style={s.stopBtn} onPress={stopRecording} activeOpacity={0.7}>
            <View style={s.stopIcon} />
            <Text style={s.stopBtnText}>停止录像</Text>
          </TouchableOpacity>
        )}
        {phase === 'done' && (
          <View style={s.actionRow}>
            <TouchableOpacity style={s.resetBtn} onPress={resetRecording} activeOpacity={0.7}>
              <Text style={s.resetBtnText}>重新录制</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.uploadBtn} onPress={doUpload} activeOpacity={0.75}>
              <Text style={s.uploadBtnText}>上传检测</Text>
            </TouchableOpacity>
          </View>
        )}
        {phase === 'uploading' && (
          <View style={s.uploadingRow}>
            <Text style={s.uploadingText}>正在上传并推理，请勿关闭...</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111111' },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10,
  },
  backBtn: { width: 44 },
  backIcon: { fontSize: 32, color: 'rgba(255,255,255,0.7)', lineHeight: 36 },
  title: { fontSize: 17, fontWeight: '600', color: '#ffffff', letterSpacing: 1 },
  recBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(220,38,38,0.18)', borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.5)', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  recText: { fontSize: 12, fontWeight: '700', color: '#ef4444', letterSpacing: 1 },
  landscapeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 20, padding: 40,
  },
  landscapeTitle: { fontSize: 22, fontWeight: '700', color: '#ffffff', marginBottom: 12 },
  landscapeDesc: { fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 36 },
  landscapeDismiss: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8, paddingHorizontal: 28, paddingVertical: 12,
  },
  landscapeDismissText: { color: 'rgba(255,255,255,0.7)', fontSize: 16 },
  statsOverlay: {
    position: 'absolute', bottom: 120, left: 0, right: 0,
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 16, zIndex: 20,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  statVal: { fontSize: 22, fontWeight: '700', color: '#ffffff' },
  statLbl: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  summaryWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 24 },
  summaryTitle: { fontSize: 24, fontWeight: '700', color: '#ffffff', letterSpacing: 1 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, width: '100%' },
  summaryCell: {
    flex: 1, minWidth: '45%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, padding: 20, alignItems: 'center', gap: 6,
  },
  summaryVal: { fontSize: 28, fontWeight: '800', color: '#ffffff' },
  summaryLbl: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  summaryNote: { fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
  uploadStatus: { fontSize: 16, color: '#3e6ae1', fontWeight: '600' },
  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 20, paddingBottom: 40,
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20,
  },
  startBtn: {
    backgroundColor: '#ef4444', borderRadius: 8,
    height: 56, alignItems: 'center', justifyContent: 'center',
  },
  startBtnText: { fontSize: 18, fontWeight: '700', color: '#ffffff', letterSpacing: 3 },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8, height: 56,
  },
  stopIcon: { width: 18, height: 18, borderRadius: 4, backgroundColor: '#ffffff' },
  stopBtnText: { fontSize: 17, fontWeight: '600', color: '#ffffff', letterSpacing: 1 },
  actionRow: { flexDirection: 'row', gap: 16 },
  resetBtn: {
    flex: 1, height: 56, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  resetBtnText: { fontSize: 16, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 },
  uploadBtn: {
    flex: 2, height: 56, borderRadius: 8,
    backgroundColor: '#3e6ae1', alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnText: { fontSize: 18, fontWeight: '700', color: '#ffffff', letterSpacing: 3 },
  uploadingRow: { height: 56, alignItems: 'center', justifyContent: 'center' },
  uploadingText: { fontSize: 15, color: 'rgba(255,255,255,0.5)' },
  permText: { color: '#ffffff', textAlign: 'center', marginTop: 120, fontSize: 16, paddingHorizontal: 32 },
  permBtn: {
    margin: 32, backgroundColor: '#3e6ae1',
    borderRadius: 8, padding: 16, alignItems: 'center',
  },
  permBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
})
