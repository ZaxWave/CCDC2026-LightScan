import { uploadFile } from './request'

export async function uploadImage(filePath, lat = null, lng = null) {
  const formData = {}
  if (lat != null) formData.lat = String(lat)
  if (lng != null) formData.lng = String(lng)
  const results = await uploadFile({ url: '/api/v1/detect', filePath, name: 'files', formData })
  return Array.isArray(results) ? results[0] : results
}

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
