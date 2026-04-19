import { Camera } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { forwardRef, useImperativeHandle, memo } from 'react'
import styles from './index.module.scss'

const CameraRecorder = memo(forwardRef(function CameraRecorder(_props, ref) {
  useImperativeHandle(ref, () => {
    let recordCtx = null
    let pendingStop = null

    return {
      start(onSuccess, onFail) {
        recordCtx = Taro.createCameraContext()
        console.log('[Camera] startRecord, ctx:', recordCtx)
        recordCtx.startRecord({
          success(res) {
            console.log('[Camera] startRecord SUCCESS', JSON.stringify(res))
            onSuccess?.()
          },
          fail(err) {
            recordCtx = null
            console.log('[Camera] startRecord FAIL', JSON.stringify(err))
            onFail?.(err?.errMsg || JSON.stringify(err) || '未知错误')
          },
        })
      },
      stop(onSuccess, onFail) {
        console.log('[Camera] stopRecord called')
        const ctx = recordCtx || Taro.createCameraContext()
        pendingStop = { onSuccess, onFail }
        ctx.stopRecord({
          compressed: false,
          success(res) {
            recordCtx = null
            pendingStop = null
            console.log('[Camera] stopRecord SUCCESS path:', res?.tempVideoPath)
            onSuccess?.(res.tempVideoPath)
          },
          fail(err) {
            recordCtx = null
            console.log('[Camera] stopRecord FAIL', JSON.stringify(err))
            if (err?.errMsg?.includes('stop error')) {
              console.log('[Camera] stop error — recording stopped, waiting for onStop')
              // onStop will fire and resolve pendingStop
            } else {
              pendingStop = null
              onFail?.(err?.errMsg || '未知错误')
            }
          },
        })
      },
      _resolvePendingStop(videoPath) {
        if (!pendingStop) return
        const { onSuccess, onFail } = pendingStop
        pendingStop = null
        if (videoPath) {
          console.log('[Camera] pendingStop resolved via onStop, path:', videoPath)
          onSuccess?.(videoPath)
        } else {
          onFail?.('录像文件路径为空，请重试')
        }
      },
    }
  }, [])

  return (
    <Camera
      className={styles.camera}
      devicePosition="back"
      flash="off"
      onStop={(e) => {
        console.log('[Camera] onStop FULL:', JSON.stringify(e))
        const videoPath = e?.detail?.tempVideoPath || e?.detail?.videoPath || null
        ref.current?._resolvePendingStop(videoPath)
      }}
      onInitDone={(e) => {
        console.log('[Camera] onInitDone:', JSON.stringify(e?.detail))
      }}
      onError={(e) => {
        const msg = e?.detail?.errMsg || '摄像头不可用，请检查权限'
        console.log('[Camera] onError:', msg)
        Taro.showToast({ title: msg, icon: 'none', duration: 3000 })
      }}
    />
  )
}))

export default CameraRecorder
