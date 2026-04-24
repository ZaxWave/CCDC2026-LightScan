import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getOrders, acceptOrder, completeOrder } from '../../api/orders'

const STATUS = {
  pending:    { label: '待处理', dot: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.22)' },
  processing: { label: '处理中', dot: '#3e6ae1', bg: 'rgba(62,106,225,0.08)', border: 'rgba(62,106,225,0.22)' },
  done:       { label: '已完成', dot: '#1a8045', bg: 'rgba(26,128,69,0.08)',   border: 'rgba(26,128,69,0.22)'  },
}

const URGENCY_COLOR = { '高危': '#d93025', '中危': '#f59e0b', '低危': '#1a8045' }

const FILTERS = [
  { key: 'all',        label: '全部' },
  { key: 'pending',    label: '待处理' },
  { key: 'processing', label: '处理中' },
  { key: 'done',       label: '已完成' },
]

function timeAgo(isoStr) {
  if (!isoStr) return '--'
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}小时前`
  return `${Math.floor(hrs / 24)}天前`
}

export default function IssuesScreen({ navigation }) {
  const [filter,     setFilter]     = useState('all')
  const [orders,     setOrders]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [actioning,  setActioning]  = useState({})

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await getOrders()
      setOrders(data || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const uiStatus = (order) => order.status === 'repaired' ? 'done' : order.status

  const counts = {
    pending:    orders.filter(o => o.status === 'pending').length,
    processing: orders.filter(o => o.status === 'processing').length,
    done:       orders.filter(o => o.status === 'repaired').length,
  }

  const list = filter === 'all'       ? orders
             : filter === 'done'      ? orders.filter(o => o.status === 'repaired')
             : orders.filter(o => o.status === filter)

  const handleAccept = async (order) => {
    setActioning(a => ({ ...a, [order.id]: true }))
    try {
      await acceptOrder(order.id)
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'processing' } : o))
    } catch {
      Alert.alert('操作失败', '请确认已登录后重试')
    } finally {
      setActioning(a => ({ ...a, [order.id]: false }))
    }
  }

  const handleComplete = async (order) => {
    Alert.alert('确认完工', `确认将工单 ${order.order_no} 标记为已完成？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确认完工', style: 'default',
        onPress: async () => {
          setActioning(a => ({ ...a, [order.id]: true }))
          try {
            await completeOrder(order.id)
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'repaired' } : o))
          } catch {
            Alert.alert('操作失败', '请确认已登录后重试')
          } finally {
            setActioning(a => ({ ...a, [order.id]: false }))
          }
        },
      },
    ])
  }

  const renderItem = ({ item: order }) => {
    const st       = STATUS[uiStatus(order)]
    const urgColor = URGENCY_COLOR[order.urgency] || '#9ca3af'
    const isActing = actioning[order.id]
    const locText  = order.lat && order.lng
      ? `${parseFloat(order.lat).toFixed(4)}°N  ${parseFloat(order.lng).toFixed(4)}°E`
      : '坐标未知'

    return (
      <View style={s.taskCard}>
        {/* 顶部：工单号 + 状态 */}
        <View style={s.taskTop}>
          <Text style={s.taskId}>{order.order_no}</Text>
          <View style={[s.statusBadge, { backgroundColor: st.bg, borderColor: st.border }]}>
            <View style={[s.statusDot, { backgroundColor: st.dot }]} />
            <Text style={[s.statusText, { color: st.dot }]}>{st.label}</Text>
          </View>
        </View>

        {/* 病害类型 + 紧急等级 */}
        <View style={s.taskMain}>
          <Text style={s.taskType}>{order.label_cn}</Text>
          <View style={[s.urgencyBadge, { borderColor: urgColor + '55', backgroundColor: urgColor + '15' }]}>
            <Text style={[s.urgencyText, { color: urgColor }]}>{order.urgency}</Text>
          </View>
        </View>

        {/* AI 生成的维修方案 */}
        {!!order.repair_method && (
          <Text style={s.repairMethod} numberOfLines={2}>{order.repair_method}</Text>
        )}

        {/* 位置 + 预计工时 */}
        <View style={s.taskMeta}>
          <Text style={s.taskLocation} numberOfLines={1}>📍 {locText}</Text>
          {!!order.estimated_hours && (
            <Text style={s.hoursText}>⏱ 约 {order.estimated_hours}h</Text>
          )}
        </View>

        {/* 底部：派发时间 + 操作按钮 */}
        <View style={s.taskBottom}>
          <Text style={s.taskTime}>{timeAgo(order.dispatched_at)}</Text>
          {order.status === 'pending' && (
            <TouchableOpacity
              style={[s.actionBtn, s.acceptBtn, isActing && s.btnDisabled]}
              onPress={() => handleAccept(order)}
              disabled={isActing}
              activeOpacity={0.75}
            >
              <Text style={s.acceptBtnText}>{isActing ? '接单中…' : '接单'}</Text>
            </TouchableOpacity>
          )}
          {order.status === 'processing' && (
            <TouchableOpacity
              style={[s.actionBtn, s.doneBtn, isActing && s.btnDisabled]}
              onPress={() => handleComplete(order)}
              disabled={isActing}
              activeOpacity={0.75}
            >
              <Text style={s.doneBtnText}>{isActing ? '提交中…' : '标记完工'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={s.page}>
        <View style={s.topBar}>
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={s.backIcon}>‹</Text>
            <Text style={s.topTitle}>养护工单</Text>
          </TouchableOpacity>
        </View>
        <View style={s.loadingBox}>
          <ActivityIndicator color="#3e6ae1" size="large" />
          <Text style={s.loadingText}>加载工单…</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.page}>
      <View style={s.topBar}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.backIcon}>‹</Text>
          <Text style={s.topTitle}>养护工单</Text>
        </TouchableOpacity>
        <Text style={s.topCount}>{counts.pending} 单待处理</Text>
      </View>

      <View style={s.stats}>
        {Object.entries(STATUS).map(([k, v]) => (
          <TouchableOpacity key={k} style={s.statItem} onPress={() => setFilter(k)} activeOpacity={0.7}>
            <Text style={[s.statNum, { color: v.dot }]}>{counts[k]}</Text>
            <Text style={s.statLabel}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.filterBar}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.filterTab, filter === f.key && s.filterTabOn]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[s.filterTabText, filter === f.key && s.filterTabTextOn]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={list}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={s.listContent}
        refreshing={refreshing}
        onRefresh={() => load(true)}
        ListEmptyComponent={
          <Text style={s.empty}>
            {filter === 'all' ? '暂无派发工单' : `暂无「${FILTERS.find(f => f.key === filter)?.label}」工单`}
          </Text>
        }
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  page:       { flex: 1, backgroundColor: '#111111' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:{ color: 'rgba(255,255,255,0.3)', marginTop: 12, fontSize: 13 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16,
  },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backIcon: { fontSize: 28, color: 'rgba(255,255,255,0.7)', lineHeight: 32 },
  topTitle: { fontSize: 18, fontWeight: '600', color: '#ffffff' },
  topCount: { fontSize: 13, color: '#f59e0b' },
  stats: {
    flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  statItem:  { flex: 1, alignItems: 'center' },
  statNum:   { fontSize: 28, fontWeight: '700' },
  statLabel: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  filterBar: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12,
    gap: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  filterTab:     { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterTabOn:   { backgroundColor: 'rgba(62,106,225,0.15)', borderColor: '#3e6ae1' },
  filterTabText:   { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  filterTabTextOn: { color: '#3e6ae1', fontWeight: '600' },
  listContent: { padding: 16, gap: 12 },
  taskCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, padding: 16, gap: 8,
  },
  taskTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskId:   { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },
  taskMain:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskType:   { fontSize: 17, fontWeight: '600', color: '#ffffff', flex: 1 },
  urgencyBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  urgencyText:  { fontSize: 12, fontWeight: '700' },
  repairMethod: { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 18 },
  taskMeta:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskLocation: { fontSize: 13, color: 'rgba(255,255,255,0.4)', flex: 1 },
  hoursText:    { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 8 },
  taskBottom:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  taskTime:     { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  actionBtn:    { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  btnDisabled:  { opacity: 0.5 },
  acceptBtn:     { backgroundColor: 'rgba(62,106,225,0.12)', borderColor: 'rgba(62,106,225,0.4)' },
  acceptBtnText: { fontSize: 13, fontWeight: '600', color: '#3e6ae1' },
  doneBtn:       { backgroundColor: 'rgba(26,128,69,0.12)', borderColor: 'rgba(26,128,69,0.4)' },
  doneBtnText:   { fontSize: 13, fontWeight: '600', color: '#1a8045' },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.3)', paddingTop: 60 },
})
