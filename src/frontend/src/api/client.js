async function request(path, body, method = 'POST') {
  const headers = {};
  
  // 1. 自动注入 Token
  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch(path, { method, headers, body });

  // 2. 401 拦截：Token 过期或未登录
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.reload(); // 强制刷新，触发 App.jsx 回到登录页
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  
  return res.json();
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

export function getGisRecords() {
  return request('/api/v1/gis/records', null, 'GET');
}
export function getMyGisRecords() {
  return request('/api/v1/gis/my-records', null, 'GET');
}
export function deleteRecord(id) {
  return request(`/api/v1/gis/records/${id}`, null, 'DELETE');
}
export function getMyProfile() {
  return request('/api/v1/users/me', null, 'GET');
}
export function changePassword(old_password, new_password) {
  return request('/api/v1/users/me/password', { old_password, new_password }, 'POST');
}
export function getMyStats() {
  return request('/api/v1/gis/my-stats', null, 'GET');
}
export function generateWeeklyReport() {
  return request('/api/v1/report/weekly', {}, 'POST');
}
export function updateProfile(data) {
  return request('/api/v1/users/me', data, 'PATCH');
}
export function getDeletedRecords() {
  return request('/api/v1/gis/deleted-records', null, 'GET');
}
export function restoreRecord(id) {
  return request(`/api/v1/gis/records/${id}/restore`, {}, 'POST');
}
export function batchDeleteRecords(ids) {
  return request('/api/v1/gis/records/batch-delete', { ids }, 'POST');
}