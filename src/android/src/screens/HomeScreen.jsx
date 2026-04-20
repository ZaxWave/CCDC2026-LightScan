import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

export default function HomeScreen({ navigation }) {
  const goToCitizen = () => navigation.navigate('Report')

  const goToWorker = async () => {
    const token = await AsyncStorage.getItem('token')
    navigation.navigate(token ? 'WorkerHub' : 'Login')
  }

  return (
    <SafeAreaView style={s.page}>
      <View style={s.brand}>
        <View style={s.wordmark}>
          <Text style={s.wordLight}>Light</Text>
          <Text style={s.wordScan}>Scan</Text>
        </View>
        <Text style={s.tagline}>智慧公路巡检系统</Text>
      </View>

      <View style={s.divider} />

      <View style={s.entries}>
        <TouchableOpacity style={s.entryRow} onPress={goToCitizen} activeOpacity={0.7}>
          <View style={s.entryLeft}>
            <Text style={s.entryTitle}>市民上报</Text>
            <Text style={s.entryDesc}>发现道路问题，拍照一键上报</Text>
          </View>
          <View style={s.entryRight}>
            <View style={s.entryTag}>
              <Text style={s.entryTagText}>随手拍</Text>
            </View>
            <Text style={s.entryChevron}>›</Text>
          </View>
        </TouchableOpacity>

        <View style={s.rowDivider} />

        <TouchableOpacity style={s.entryRow} onPress={goToWorker} activeOpacity={0.7}>
          <View style={s.entryLeft}>
            <Text style={s.entryTitle}>巡检员工作台</Text>
            <Text style={s.entryDesc}>查看工单，记录处理，专业巡检</Text>
          </View>
          <View style={s.entryRight}>
            <View style={[s.entryTag, s.entryTagBlue]}>
              <Text style={[s.entryTagText, s.entryTagTextBlue]}>专业版</Text>
            </View>
            <Text style={s.entryChevron}>›</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>LightScan v1.0</Text>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111111', justifyContent: 'center', paddingHorizontal: 32 },
  brand: { alignItems: 'center', marginBottom: 48 },
  wordmark: { flexDirection: 'row', alignItems: 'baseline' },
  wordLight: { fontSize: 48, fontWeight: '300', color: '#ffffff', letterSpacing: 2 },
  wordScan: { fontSize: 48, fontWeight: '800', color: '#3e6ae1', letterSpacing: 2 },
  tagline: { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 8, letterSpacing: 4 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 48 },
  entries: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  entryRow: { flexDirection: 'row', alignItems: 'center', padding: 24 },
  entryLeft: { flex: 1 },
  entryTitle: { fontSize: 18, fontWeight: '600', color: '#ffffff', marginBottom: 4 },
  entryDesc: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  entryRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  entryTag: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  entryTagText: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  entryTagBlue: { backgroundColor: 'rgba(62,106,225,0.15)' },
  entryTagTextBlue: { color: '#3e6ae1' },
  entryChevron: { fontSize: 24, color: 'rgba(255,255,255,0.3)', marginLeft: 4 },
  rowDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 24 },
  footer: { textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 48 },
})
