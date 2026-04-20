import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

export default function HubScreen({ navigation }) {
  const [user, setUser] = useState({})

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) setUser(JSON.parse(raw))
    })
  }, [])

  const logout = () => {
    Alert.alert('退出登录', '确认退出专业版？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        onPress: async () => {
          await AsyncStorage.multiRemove(['token', 'user'])
          navigation.replace('Home')
        },
      },
    ])
  }

  return (
    <SafeAreaView style={s.page}>
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>{user.name || '巡检员'}</Text>
          <Text style={s.greetingSub}>今日工作台</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={logout} activeOpacity={0.7}>
          <Text style={s.logoutText}>退出</Text>
        </TouchableOpacity>
      </View>

      <View style={s.tiles}>
        <TouchableOpacity style={s.tile} onPress={() => navigation.navigate('Issues')} activeOpacity={0.7}>
          <View style={s.tileBody}>
            <Text style={s.tileTitle}>已有问题</Text>
            <Text style={s.tileDesc}>查看工单 · 处理记录</Text>
          </View>
          <Text style={s.tileArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.tile, s.tileDark]}
          onPress={() => navigation.navigate('Record')}
          activeOpacity={0.7}
        >
          <View style={s.recDot} />
          <View style={s.tileBody}>
            <Text style={[s.tileTitle, s.tileTitleLight]}>开始巡检</Text>
            <Text style={[s.tileDesc, s.tileDescLight]}>GPS 轨迹 · 5m 间隔抽帧</Text>
          </View>
          <Text style={[s.tileArrow, s.tileArrowLight]}>›</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111111' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 40,
  },
  greeting: { fontSize: 28, fontWeight: '700', color: '#ffffff' },
  greetingSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  logoutBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  logoutText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  tiles: { paddingHorizontal: 24, gap: 16 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 28,
    gap: 16,
  },
  tileDark: { backgroundColor: '#0d1b3e', borderColor: '#3e6ae1' },
  tileBody: { flex: 1 },
  tileTitle: { fontSize: 20, fontWeight: '600', color: '#ffffff', marginBottom: 6 },
  tileTitleLight: { color: '#ffffff' },
  tileDesc: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  tileDescLight: { color: 'rgba(255,255,255,0.4)' },
  tileArrow: { fontSize: 28, color: 'rgba(255,255,255,0.3)' },
  tileArrowLight: { color: 'rgba(255,255,255,0.3)' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
})
