async function request(path, body) {
  const res = await fetch(path, { method: 'POST', body })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export function detectImages(files) {
  const form = new FormData()
  files.forEach(f => form.append('files', f))
  return request('/api/v1/detect', form)
}

export function getFirstFrame(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/api/v1/detect-video/first-frame', form)
}

export function detectVideo(file, config) {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', config.mode)
  form.append('interval_meters', config.intervalM)
  if (config.mode === 'ocr' && config.region) {
    const { x1, y1, x2, y2 } = config.region
    form.append('ocr_region', `${x1},${y1},${x2},${y2}`)
  }
  if (config.mode === 'timed') {
    form.append('approx_speed_kmh', config.speedKmh)
  }
  return request('/api/v1/detect-video', form)
}
