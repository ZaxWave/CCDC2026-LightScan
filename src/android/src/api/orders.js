import { request } from './request'

export async function getOrders(status = null) {
  const qs = status ? `?status=${status}` : ''
  return request({ url: `/api/v1/disease/orders${qs}` })
}

export async function acceptOrder(recordId) {
  return request({
    method: 'PATCH',
    url: `/api/v1/disease/orders/${recordId}/status`,
    data: { status: 'processing' },
  })
}

export async function completeOrder(recordId) {
  return request({
    method: 'PATCH',
    url: `/api/v1/disease/orders/${recordId}/status`,
    data: { status: 'repaired' },
  })
}
