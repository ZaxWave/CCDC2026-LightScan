import { uploadFile, request } from './request'

export async function uploadImage(filePath, lat = null, lng = null) {
  const formData = {}
  if (lat != null) formData.lat = String(lat)
  if (lng != null) formData.lng = String(lng)
  const results = await uploadFile({ url: '/api/v1/detect', filePath, name: 'files', formData })
  return Array.isArray(results) ? results[0] : results
}

/**
 * 提交视频检测任务，立即返回 task_id（后端异步处理）。
 * 适用于：后台队列静默上传，不需要等待结果。
 */
export async function submitVideo(filePath, gpsTrack, intervalMeters = 5) {
  const res = await uploadFile({
    url: '/api/v1/detect-video',
    filePath,
    name: 'file',
    formData: {
      mode: 'gps',
      gps_track: JSON.stringify(gpsTrack),
      interval_meters: String(intervalMeters),
    },
  })
  return res.task_id
}

/**
 * 提交视频任务并轮询，直到后端推理完成，返回最终检测结果。
 * 适用于：用户在线时主动上传并展示检测结果。
 */
export async function uploadVideoAndPoll(filePath, gpsTrack, intervalMeters = 5, onProgress) {
  const taskId = await submitVideo(filePath, gpsTrack, intervalMeters)

  // 最多等待 20 分钟（400 次 × 3 秒）
  for (let i = 0; i < 400; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const data = await request({ method: 'GET', url: `/api/v1/detect-video/status/${taskId}` })
    if (data.status === 'done')   return data.result
    if (data.status === 'failed') throw new Error(data.error || '推理失败')
    onProgress?.(data)
  }
  throw new Error('任务超时，结果已在后台保存，请稍后查看记录')
}
