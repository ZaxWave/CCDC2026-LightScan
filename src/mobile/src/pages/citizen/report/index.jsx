import { View, Text, Image, ScrollView, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { uploadImage } from '../../../api/detect'
import styles from './index.module.scss'

const LABEL_CN_TO_TYPE = {
  '纵向裂缝': '裂缝',
  '横向裂缝': '裂缝',
  '龟裂':    '裂缝',
  '坑槽':    '坑槽',
}

const MAX_DESC = 200

export default function CitizenReport() {
  const [detectMode, setDetectMode] = useState('ai')
  const [selectedType, setSelectedType] = useState(null)
  const [photos, setPhotos] = useState([])
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoDetecting, setAutoDetecting] = useState(false)
  const [aiDetected, setAiDetected] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('idle')
  const [gpsCoords, setGpsCoords] = useState(null)

  const types = ['坑槽', '裂缝', '拥包', '沉陷', '车辙', '其他']

  const goBack = () => {
    const pages = Taro.getCurrentPages()
    if (pages.length > 1) {
      Taro.navigateBack()
    } else {
      Taro.reLaunch({ url: '/pages/index/index' })
    }
  }

  const switchMode = (mode) => {
    setDetectMode(mode)
    setSelectedType(null)
    setAiDetected(false)
  }

  const handleAddPhoto = async () => {
    let res
    try {
      res = await Taro.chooseMedia({ count: 9 - photos.length, mediaType: ['image'] })
    } catch {
      return
    }
    const newPaths = res.tempFiles.map(f => f.tempFilePath)
    setPhotos(prev => [...prev, ...newPaths])

    if (detectMode === 'ai' && photos.length === 0 && newPaths.length > 0) {
      setAutoDetecting(true)
      setAiDetected(false)
      try {
        const result = await uploadImage(newPaths[0], null, null)
        const dets = result?.detections ?? []
        if (dets.length > 0) {
          const top = dets.reduce((a, b) => (a.conf > b.conf ? a : b))
          const mapped = LABEL_CN_TO_TYPE[top.label_cn] ?? '其他'
          setSelectedType(mapped)
          setAiDetected(true)
        }
      } catch {
        // 识别失败静默处理，用户可手动选择
      } finally {
        setAutoDetecting(false)
      }
    }
  }

  const removePhoto = (index) => {
    setPhotos(prev => {
      const next = [...prev]
      next.splice(index, 1)
      return next
    })
  }

  const handleSubmit = async () => {
    if (photos.length === 0) {
      Taro.showToast({ title: '请至少添加一张照片', icon: 'none' })
      return
    }
    if (detectMode === 'manual' && !selectedType) {
      Taro.showToast({ title: '请选择病害类型', icon: 'none' })
      return
    }
    if (detectMode === 'ai' && autoDetecting) {
      Taro.showToast({ title: 'AI识别中，请稍候', icon: 'none' })
      return
    }
    if (loading) return
    setLoading(true)

    // Step 1: GPS 定位 — 有独立 hideLoading 防止泄漏
    let lat = null
    let lng = null
    try {
      Taro.showLoading({ title: '定位中...' })
      const loc = await Taro.getLocation({ type: 'gcj02' })
      lat = loc.latitude
      lng = loc.longitude
      setGpsCoords({ lat, lng })
      setGpsStatus('ok')
    } catch {
      setGpsStatus('failed')
    } finally {
      Taro.hideLoading()
    }

    // Step 2: 逐张上传
    try {
      Taro.showLoading({ title: '上报中...' })
      for (const filePath of photos) {
        await uploadImage(filePath, lat, lng)
      }
      Taro.hideLoading()
      setLoading(false)
      Taro.showToast({ title: '提交成功', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 1500)
    } catch (e) {
      Taro.hideLoading()
      setLoading(false)
      Taro.showToast({ title: `上报失败：${e.message}`, icon: 'none', duration: 3000 })
    }
  }

  return (
    <View className={styles.page}>
      <View className={styles.header}>
        <View className={styles.headerLeft}>
          <View className={styles.backBtn} onClick={goBack}>
            <Text className={styles.backIcon}>‹</Text>
          </View>
          <Text className={styles.headerTitle}>问题上报</Text>
        </View>
        <Text className={styles.headerSub}>随手拍</Text>
      </View>

      <ScrollView scrollY className={styles.bodyScroll}>
        <View className={styles.body}>
          {/* 病害类型 */}
          <View className={styles.section}>
            <View className={styles.secHeader}>
              <Text className={styles.secLabel}>病害类型</Text>
            </View>

            <View className={styles.modeSwitch}>
              <View
                className={`${styles.modeBtn} ${detectMode === 'ai' ? styles.modeBtnOn : ''}`}
                onClick={() => switchMode('ai')}
              >
                <Text className={styles.modeBtnText}>AI 识别</Text>
              </View>
              <View
                className={`${styles.modeBtn} ${detectMode === 'manual' ? styles.modeBtnOn : ''}`}
                onClick={() => switchMode('manual')}
              >
                <Text className={styles.modeBtnText}>手动选择</Text>
              </View>
            </View>

            {detectMode === 'ai' ? (
              <View className={styles.aiStatus}>
                <Text className={styles.aiStatusText}>
                  {autoDetecting
                    ? '识别中...'
                    : aiDetected
                    ? `已识别：${selectedType}`
                    : '添加照片后自动识别类型'}
                </Text>
              </View>
            ) : (
              <View className={styles.typeGrid}>
                {types.map(t => (
                  <View
                    key={t}
                    className={`${styles.typeItem} ${selectedType === t ? styles.typeItemActive : ''}`}
                    onClick={() => setSelectedType(t)}
                  >
                    <Text className={styles.typeItemLabel}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* 现场照片 */}
          <View className={styles.section}>
            <View className={styles.secHeader}>
              <Text className={styles.secLabel}>现场照片</Text>
              <Text className={styles.secNote}>{photos.length}/9</Text>
            </View>
            <View className={styles.photoGrid}>
              {photos.map((p, i) => (
                <View key={p} className={styles.photoCell}>
                  <Image src={p} mode='aspectFill' className={styles.photoImg} />
                  <View className={styles.photoRemove} onClick={() => removePhoto(i)}>
                    <Text className={styles.removeX}>×</Text>
                  </View>
                </View>
              ))}
              {photos.length < 9 && (
                <View className={styles.photoAdd} onClick={handleAddPhoto}>
                  <Text className={styles.addPlus}>+</Text>
                  <Text className={styles.addLabel}>添加照片</Text>
                </View>
              )}
            </View>
          </View>

          {/* 描述路面情况 */}
          <View className={styles.section}>
            <Textarea
              className={styles.textarea}
              placeholder='请简要描述路面情况...'
              placeholderClass={styles.ph}
              value={desc}
              maxlength={MAX_DESC}
              onInput={e => setDesc(e.detail.value)}
            />
            <Text className={styles.charCount}>{desc.length}/{MAX_DESC}</Text>
          </View>

          <View
            className={`${styles.submitBtn} ${loading ? styles.submitBtnLoading : ''}`}
            onClick={handleSubmit}
          >
            <Text className={styles.submitText}>提交</Text>
          </View>

          <Text className={styles.privacy}>
            提交即代表您同意《LightScan 众包协议》{"\n"}
            {gpsStatus === 'ok'
              ? `已定位：${gpsCoords.lat.toFixed(5)}, ${gpsCoords.lng.toFixed(5)}`
              : gpsStatus === 'failed'
              ? '定位失败，将以无坐标上报'
              : '提交时将自动获取您的地理位置'}
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}
