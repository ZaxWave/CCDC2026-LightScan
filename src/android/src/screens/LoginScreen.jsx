import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

export default function LoginScreen({ navigation }) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async () => {
    if (!account.trim() || !password.trim()) {
      setError('请填写账号和密码')
      return
    }
    setError('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 1400))
    await AsyncStorage.setItem('token', 'mock_token_123')
    await AsyncStorage.setItem('user', JSON.stringify({ account, name: account }))
    setLoading(false)
    navigation.replace('WorkerHub')
  }

  return (
    <SafeAreaView style={s.page}>
      <View style={s.topBar}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.6}>
          <Text style={s.backIcon}>‹</Text>
          <Text style={s.backText}>返回</Text>
        </TouchableOpacity>
      </View>

      <View style={s.header}>
        <Text style={s.roleLabel}>INSPECTOR · 巡检员</Text>
        <Text style={s.title}>登录</Text>
        <Text style={s.subtitle}>使用工号和系统密码登录专业版</Text>
      </View>

      <View style={s.form}>
        <View style={s.field}>
          <Text style={s.fieldLabel}>工号 / 账号</Text>
          <TextInput
            style={s.input}
            placeholder="请输入工号"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={account}
            onChangeText={setAccount}
            autoCapitalize="none"
          />
          <View style={s.inputUnderline} />
        </View>

        <View style={s.field}>
          <Text style={s.fieldLabel}>密码</Text>
          <TextInput
            style={s.input}
            placeholder="请输入密码"
            placeholderTextColor="rgba(255,255,255,0.25)"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <View style={s.inputUnderline} />
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[s.submitBtn, loading && s.submitLoading]}
          onPress={loading ? undefined : handleLogin}
          activeOpacity={0.75}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.submitText}>登 录</Text>
          }
        </TouchableOpacity>

        <Text style={s.demoHint}>演示：任意工号 + 任意密码</Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111111' },
  topBar: { paddingHorizontal: 24, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backIcon: { fontSize: 28, color: 'rgba(255,255,255,0.6)', lineHeight: 32 },
  backText: { fontSize: 16, color: 'rgba(255,255,255,0.6)' },
  header: { paddingHorizontal: 32, paddingTop: 48, paddingBottom: 40 },
  roleLabel: { fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: 3, marginBottom: 12 },
  title: { fontSize: 36, fontWeight: '700', color: '#ffffff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  form: { paddingHorizontal: 32, gap: 20 },
  field: { gap: 8 },
  fieldLabel: { fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  input: { fontSize: 16, color: '#ffffff', paddingVertical: 8 },
  inputUnderline: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  errorBox: {
    backgroundColor: 'rgba(220,38,38,0.1)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.3)',
  },
  errorText: { color: '#ef4444', fontSize: 14 },
  submitBtn: {
    backgroundColor: '#3e6ae1',
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitLoading: { opacity: 0.7 },
  submitText: { fontSize: 16, fontWeight: '700', color: '#ffffff', letterSpacing: 4 },
  demoHint: { textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 4 },
})
