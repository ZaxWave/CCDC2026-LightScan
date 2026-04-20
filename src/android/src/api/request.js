import AsyncStorage from '@react-native-async-storage/async-storage'

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000'

async function getToken() {
  return (await AsyncStorage.getItem('token')) || ''
}

export async function uploadFile({ url, filePath, name = 'file', formData = {} }) {
  const token = await getToken()
  const ext = filePath.split('.').pop().toLowerCase()
  const isVideo = ['mp4', 'mov', 'avi'].includes(ext)
  const mimeType = isVideo ? 'video/mp4' : 'image/jpeg'
  const filename = filePath.split('/').pop() || `upload.${ext}`

  const data = new FormData()
  data.append(name, { uri: filePath, name: filename, type: mimeType })
  for (const [key, value] of Object.entries(formData)) {
    data.append(key, String(value))
  }

  const res = await fetch(`${BASE_URL}${url}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: data,
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function request({ method = 'GET', url, data } = {}) {
  const token = await getToken()
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
