/**
 * offlineQueue.js — AsyncStorage-backed upload queue for offline-first巡检.
 *
 * Each queued item:
 *   { id, videoUri, gpsPoints, intervalMeters, savedAt, retries }
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const QUEUE_KEY = 'ls_upload_queue'
export const MAX_RETRIES = 3

export async function getQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function saveQueue(queue) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function enqueue({ videoUri, gpsPoints, intervalMeters = 5 }) {
  const queue = await getQueue()
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    videoUri,
    gpsPoints,
    intervalMeters,
    savedAt: new Date().toISOString(),
    retries: 0,
  }
  await saveQueue([...queue, item])
  return item.id
}

export async function removeFromQueue(id) {
  const queue = await getQueue()
  await saveQueue(queue.filter(i => i.id !== id))
}

export async function markRetry(id) {
  const queue = await getQueue()
  await saveQueue(queue.map(i => i.id === id ? { ...i, retries: i.retries + 1 } : i))
}

export async function clearExpired() {
  const queue = await getQueue()
  // Drop items that permanently failed (too many retries)
  await saveQueue(queue.filter(i => i.retries < MAX_RETRIES))
}
