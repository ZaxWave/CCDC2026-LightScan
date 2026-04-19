import { uploadFile } from './request'

/**
 * 上传单张图片进行病害检测，附带可选 GPS 坐标
 * @param {string}      filePath  - 图片临时路径（Taro.chooseMedia 返回的 tempFilePath）
 * @param {number|null} lat       - 纬度（gcj02），无则传 null
 * @param {number|null} lng       - 经度（gcj02），无则传 null
 * @returns {Promise<object>}     - 单条检测结果 {filename, detections, image_b64, location, ...}
 */
export async function uploadImage(filePath, lat = null, lng = null) {
  const formData = {}
  if (lat != null) formData.lat = String(lat)
  if (lng != null) formData.lng = String(lng)

  const results = await uploadFile({
    url: '/api/v1/detect',
    filePath,
    name: 'files',
    formData,
  })
  // 后端返回 list，取第一项
  return Array.isArray(results) ? results[0] : results
}

/**
 * 上传巡检视频 + GPS 轨迹，使用 gps 模式按真实距离抽帧
 * @param {string} filePath        - 视频临时路径
 * @param {Array}  gpsTrack        - [{lat, lng, timestamp_ms, speed_kmh}, ...]
 * @param {number} intervalMeters  - 抽帧间隔（米），默认 5m
 * @returns {Promise<object>}      - {status, total_frames, results: [...]}
 */
export async function uploadVideo(filePath, gpsTrack, intervalMeters = 5) {
  return uploadFile({
    url: '/api/v1/detect-video',
    filePath,
    name: 'file',
    formData: {
      mode: 'gps',
      gps_track: JSON.stringify(gpsTrack),
      interval_meters: String(intervalMeters),
    },
  })
}
