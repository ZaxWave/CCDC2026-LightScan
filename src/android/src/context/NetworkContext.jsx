/**
 * NetworkContext — 网络状态检测 + 离线队列自动上传
 *
 * 通过定期 ping /health 端点判断联网状态。
 * 离线→联网时自动触发 processQueue，将积压视频依次上传。
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { AppState } from 'react-native'
import { BASE_URL } from '../api/request'
import { getQueue, removeFromQueue, markRetry, clearExpired, MAX_RETRIES } from '../utils/offlineQueue'
import { submitVideo } from '../api/detect'

const NetworkCtx = createContext({
  isOnline: true,
  queueCount: 0,
  refreshQueueCount: () => {},
  processQueue: async () => {},
})

const POLL_MS = 5000

async function pingServer() {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 3000)
  try {
    const r = await fetch(`${BASE_URL}/health`, { signal: controller.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    clearTimeout(t)
    return false
  }
}

export function NetworkProvider({ children }) {
  const [isOnline, setIsOnline]     = useState(true)
  const [queueCount, setQueueCount] = useState(0)
  const prevOnline   = useRef(true)
  const processing   = useRef(false)

  const refreshQueueCount = useCallback(async () => {
    const q = await getQueue()
    setQueueCount(q.length)
  }, [])

  /** 依次上传队列中所有待处理项 */
  const processQueue = useCallback(async () => {
    if (processing.current) return
    processing.current = true
    try {
      await clearExpired()
      const queue = await getQueue()
      for (const item of queue) {
        try {
          // 只提交任务即可，后端异步推理并写入数据库
          await submitVideo(item.videoUri, item.gpsPoints, item.intervalMeters)
          await removeFromQueue(item.id)
        } catch {
          if (item.retries + 1 >= MAX_RETRIES) {
            await removeFromQueue(item.id)
          } else {
            await markRetry(item.id)
          }
        }
      }
    } finally {
      processing.current = false
      refreshQueueCount()
    }
  }, [refreshQueueCount])

  // 定时轮询网络状态
  useEffect(() => {
    refreshQueueCount()

    const tick = async () => {
      const online = await pingServer()
      setIsOnline(online)
      if (online && !prevOnline.current) {
        // 刚恢复联网 → 自动上传积压队列
        processQueue()
      }
      prevOnline.current = online
    }

    tick() // 立即执行一次
    const timer = setInterval(tick, POLL_MS)
    return () => clearInterval(timer)
  }, [processQueue, refreshQueueCount])

  // App 从后台切回前台时也检查一次
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') processQueue()
    })
    return () => sub.remove()
  }, [processQueue])

  return (
    <NetworkCtx.Provider value={{ isOnline, queueCount, refreshQueueCount, processQueue }}>
      {children}
    </NetworkCtx.Provider>
  )
}

export function useNetwork() {
  return useContext(NetworkCtx)
}
