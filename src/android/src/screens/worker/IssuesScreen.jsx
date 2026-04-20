import { useState } from 'react'
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const STATUS = {
  pending:    { label: '待处理', dot: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.22)' },
  processing: { label: '处理中', dot: '#3e6ae1', bg: 'rgba(62,106,225,0.08)', border: 'rgba(62,106,225,0.22)' },
  done:       { label: '已完成', dot: '#1a8045', bg: 'rgba(26,128,69,0.08)',   border: 'rgba(26,128,69,0.22)'  },
}

const LEVEL_COLOR = { '严重': '#d93025', '中等': '#f59e0b', '轻微': '#1a8045' }

const MOCK = [
  { id: 'LS-001', type: '路面坑洞', location: '朝阳区建国路88号附近',     status: 'pending',    time: '10分钟前', level: '严重' },
  { id: 'LS-002', type: '护栏损坏', location: '海淀区中关村大街12号',     status: 'processing', time: '1小时前',  level: '中等' },
  { id: 'LS-003', type: '标线磨损', location: '西城区长安街与复兴路交口', status: 'done',       time: '昨天',    level: '轻微' },
  { id: 'LS-004', type: '路面裂缝', location: '丰台区南三环中路',         status: 'pending',    time: '30分钟前', level: '中等' },
  { id: 'LS-005', type: '积水内涝', location: '通州区运河东大街',         status: 'processing', time: '2小时前',  level: '严重' },
  { id: 'LS-006', type: '路面坑洞', location: '石景山区阜石路',           status: 'pending',    time: '5分钟前',  level: '严重' },
]

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'processing', label: '处理中' },
  { key: 'done', label: '已完成' },
]

export default function IssuesScreen({ navigation }) {
  const [filter, setFilter] = useState('all')
  const list = filter === 'all' ? MOCK : MOCK.filter(t => t.status === filter)
  const pendingCount = MOCK.filter(t => t.status === 'pending').length
  const counts = {
    pending: pendingCount,
    processing: MOCK.filter(t => t.status === 'processing').length,
    done: MOCK.filter(t => t.status === 'done').length,
  }

  const renderItem = ({ item: task }) => {
    const st = STATUS[task.status]
    return (
      <View style={s.taskCard}>
        <View style={s.taskTop}>
          <Text style={s.taskId}>{task.id}</Text>
          <View style={[s.statusBadge, { backgroundColor: st.bg, borderColor: st.border }]}>
            <View style={[s.statusDot, { backgroundColor: st.dot }]} />
            <Text style={[s.statusText, { color: st.dot }]}>{st.label}</Text>
          </View>
        </View>
        <View style={s.taskMain}>
          <Text style={s.taskType}>{task.type}</Text>
          <Text style={[s.levelText, { color: LEVEL_COLOR[task.level] }]}>{task.level}</Text>
        </View>
        <Text style={s.taskLocation}>{task.location}</Text>
        <View style={s.taskBottom}>
          <Text style={s.taskTime}>{task.time}</Text>
          <Text style={s.actionText}>查看详情 ›</Text>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={s.page}>
      <View style={s.topBar}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.backIcon}>‹</Text>
          <Text style={s.topTitle}>已有问题</Text>
        </TouchableOpacity>
        <Text style={s.topCount}>{pendingCount} 单待处理</Text>
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
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={<Text style={s.empty}>暂无工单</Text>}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111111' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backIcon: { fontSize: 28, color: 'rgba(255,255,255,0.7)', lineHeight: 32 },
  topTitle: { fontSize: 18, fontWeight: '600', color: '#ffffff' },
  topCount: { fontSize: 13, color: '#f59e0b' },
  stats: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 28, fontWeight: '700' },
  statLabel: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterTabOn: { backgroundColor: 'rgba(62,106,225,0.15)', borderColor: '#3e6ae1' },
  filterTabText: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  filterTabTextOn: { color: '#3e6ae1', fontWeight: '600' },
  listContent: { padding: 16, gap: 12 },
  taskCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  taskTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskId: { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },
  taskMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskType: { fontSize: 17, fontWeight: '600', color: '#ffffff' },
  levelText: { fontSize: 13, fontWeight: '600' },
  taskLocation: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  taskBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskTime: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  actionText: { fontSize: 13, color: '#3e6ae1' },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.3)', paddingTop: 60 },
})
