import { useState } from 'react'
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  TextInput, Alert, ActivityIndicator, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { uploadImage } from '../../api/detect'

const LABEL_CN_TO_TYPE = { '纵向裂缝': '裂缝', '横向裂缝': '裂缝', '龟裂': '裂缝', '坑槽': '坑槽' }
const MAX_DESC = 200
const TYPES = ['坑槽', '裂缝', '拥包', '沉陷', '车辙', '其他']

export default function ReportScreen({ navigation }) {
  const [detectMode, setDetectMode] = useState('ai')
  const [selectedType, setSelectedType] = useState(null)
  const [photos, setPhotos] = useState([])
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoDetecting, setAutoDetecting] = useState(false)
  const [aiDetected, setAiDetected] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('idle')
  const [gpsCoords, setGpsCoords] = useState(null)

  const switchMode = (mode) => { setDetectMode(mode); setSelectedType(null); setAiDetected(false) }

  const addPhotos = async (newPaths, currentCount) => {
    setPhotos(prev => [...prev, ...newPaths])
    if (detectMode === 'ai' && currentCount === 0 && newPaths.length > 0) {
      setAutoDetecting(true)
      try {
        const result = await uploadImage(newPaths[0], null, null)
        const dets = result?.detections ?? []
        if (dets.length > 0) {
          const top = dets.reduce((a, b) => (a.conf > b.conf ? a : b))
          setSelectedType(LABEL_CN_TO_TYPE[top.label_cn] ?? '其他')
          setAiDetected(true)
        }
      } catch { /* silent */ } finally {
        setAutoDetecting(false)
      }
    }
  }

  const handleAddPhoto = () => {
    const remaining = 9 - photos.length
    const count = photos.length
    Alert.alert('添加照片', '选择来源', [
      {
        text: '拍照',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync()
          if (status !== 'granted') { Alert.alert('需要摄像头权限'); return }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.8 })
          if (!result.canceled) addPhotos(result.assets.map(a => a.uri), count)
        },
      },
      {
        text: '从相册选取',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
          if (status !== 'granted') { Alert.alert('需要相册权限'); return }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            quality: 0.8,
            selectionLimit: remaining,
          })
          if (!result.canceled) addPhotos(result.assets.map(a => a.uri), count)
        },
      },
      { text: '取消', style: 'cancel' },
    ])
  }

  const removePhoto = (index) => setPhotos(prev => prev.filter((_, i) => i !== index))

  const handleSubmit = async () => {
    if (photos.length === 0) { Alert.alert('请至少添加一张照片'); return }
    if (detectMode === 'manual' && !selectedType) { Alert.alert('请选择病害类型'); return }
    if (loading) return
    setLoading(true)

    let lat = null, lng = null
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        lat = loc.coords.latitude
        lng = loc.coords.longitude
        setGpsCoords({ lat, lng })
        setGpsStatus('ok')
      } else {
        setGpsStatus('failed')
      }
    } catch { setGpsStatus('failed') }

    try {
      for (const filePath of photos) await uploadImage(filePath, lat, lng)
      setLoading(false)
      Alert.alert('提交成功', '感谢您的上报！', [{ text: '确定', onPress: () => navigation.goBack() }])
    } catch (e) {
      setLoading(false)
      Alert.alert('上报失败', e.message)
    }
  }

  return (
    <SafeAreaView style={s.page}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={s.backIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>问题上报</Text>
        </View>
        <Text style={s.headerSub}>随手拍</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>

        {/* 病害类型 */}
        <Text style={s.secLabel}>病害类型</Text>
        <View style={s.modeSwitch}>
          {['ai', 'manual'].map(m => (
            <TouchableOpacity
              key={m}
              style={[s.modeBtn, detectMode === m && s.modeBtnOn]}
              onPress={() => switchMode(m)}
              activeOpacity={0.7}
            >
              <Text style={[s.modeBtnText, detectMode === m && s.modeBtnTextOn]}>
                {m === 'ai' ? 'AI 识别' : '手动选择'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {detectMode === 'ai' ? (
          <View style={s.aiStatus}>
            <Text style={s.aiStatusText}>
              {autoDetecting ? '识别中...' : aiDetected ? `已识别：${selectedType}` : '添加照片后自动识别类型'}
            </Text>
          </View>
        ) : (
          <View style={s.typeGrid}>
            {TYPES.map(t => (
              <TouchableOpacity
                key={t}
                style={[s.typeItem, selectedType === t && s.typeItemActive]}
                onPress={() => setSelectedType(t)}
                activeOpacity={0.7}
              >
                <Text style={[s.typeItemLabel, selectedType === t && s.typeItemLabelActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 现场照片 */}
        <View style={s.secHeader}>
          <Text style={s.secLabel}>现场照片</Text>
          <Text style={s.secNote}>{photos.length}/9</Text>
        </View>
        <View style={s.photoGrid}>
          {photos.map((p, i) => (
            <View key={`photo-${i}`} style={s.photoCell}>
              <Image source={{ uri: p }} style={s.photoImg} resizeMode="cover" />
              <TouchableOpacity style={s.photoRemove} onPress={() => removePhoto(i)}>
                <Text style={s.removeX}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < 9 && (
            <TouchableOpacity style={s.photoAdd} onPress={handleAddPhoto} activeOpacity={0.7}>
              <Text style={s.addPlus}>+</Text>
              <Text style={s.addLabel}>添加照片</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 描述路面情况 */}
        <Text style={s.secLabel}>描述路面情况</Text>
        <TextInput
          style={s.textarea}
          placeholder="请简要描述路面情况..."
          placeholderTextColor="rgba(255,255,255,0.25)"
          multiline
          numberOfLines={4}
          value={desc}
          onChangeText={t => setDesc(t.slice(0, MAX_DESC))}
          textAlignVertical="top"
        />
        <Text style={s.charCount}>{desc.length}/{MAX_DESC}</Text>

        <TouchableOpacity
          style={[s.submitBtn, loading && s.submitBtnLoading]}
          onPress={handleSubmit}
          activeOpacity={0.75}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>提交</Text>}
        </TouchableOpacity>

        <Text style={s.privacy}>
          {gpsStatus === 'ok' && gpsCoords
            ? `已定位：${gpsCoords.lat.toFixed(5)}, ${gpsCoords.lng.toFixed(5)}`
            : gpsStatus === 'failed'
            ? '定位失败，将以无坐标上报'
            : '提交时将自动获取您的地理位置'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111111' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backIcon: { fontSize: 28, color: 'rgba(255,255,255,0.7)', lineHeight: 32 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#ffffff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  scroll: { flex: 1 },
  body: { padding: 20, gap: 12, paddingBottom: 48 },
  secHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secLabel: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)', letterSpacing: 1 },
  secNote: { fontSize: 13, color: 'rgba(255,255,255,0.35)' },
  modeSwitch: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center',
  },
  modeBtnOn: { backgroundColor: 'rgba(62,106,225,0.15)', borderColor: '#3e6ae1' },
  modeBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },
  modeBtnTextOn: { color: '#3e6ae1', fontWeight: '700' },
  aiStatus: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 14 },
  aiStatusText: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeItem: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  typeItemActive: { backgroundColor: 'rgba(62,106,225,0.15)', borderColor: '#3e6ae1' },
  typeItemLabel: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  typeItemLabelActive: { color: '#3e6ae1', fontWeight: '700' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoCell: { width: 100, height: 100, borderRadius: 8, overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  removeX: { color: '#ffffff', fontSize: 16, lineHeight: 20 },
  photoAdd: {
    width: 100, height: 100, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addPlus: { fontSize: 28, color: 'rgba(255,255,255,0.3)' },
  addLabel: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  textarea: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#ffffff', minHeight: 100,
  },
  charCount: { textAlign: 'right', fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  submitBtn: {
    backgroundColor: '#3e6ae1', borderRadius: 10,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitBtnLoading: { opacity: 0.7 },
  submitText: { fontSize: 17, fontWeight: '700', color: '#ffffff', letterSpacing: 2 },
  privacy: { textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.25)' },
})
