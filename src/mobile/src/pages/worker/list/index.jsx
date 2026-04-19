import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect } from 'react'
import styles from './index.module.scss'

export default function WorkerHub() {
  const [user, setUser] = useState({})

  useEffect(() => {
    const u = Taro.getStorageSync('user')
    if (u) setUser(u)
  }, [])

  const logout = () => {
    Taro.showModal({
      title: '退出登录',
      content: '确认退出专业版？',
      success: r => {
        if (r.confirm) {
          Taro.removeStorageSync('token')
          Taro.removeStorageSync('user')
          Taro.redirectTo({ url: '/pages/index/index' })
        }
      }
    })
  }

  return (
    <View className={styles.page}>
      <View className={styles.header}>
        <View>
          <Text className={styles.greeting}>{user.name || '巡检员'}</Text>
          <Text className={styles.greetingSub}>今日工作台</Text>
        </View>
        <View className={styles.logoutBtn} onClick={logout}>
          <Text className={styles.logoutText}>退出</Text>
        </View>
      </View>

      <View className={styles.tiles}>
        <View
          className={styles.tile}
          onClick={() => Taro.navigateTo({ url: '/pages/worker/issues/index' })}
        >
          <View className={styles.tileBody}>
            <Text className={styles.tileTitle}>已有问题</Text>
            <Text className={styles.tileDesc}>查看工单 · 处理记录</Text>
          </View>
          <Text className={styles.tileArrow}>›</Text>
        </View>

        <View
          className={`${styles.tile} ${styles.tileDark}`}
          onClick={() => Taro.navigateTo({ url: '/pages/worker/record/index' })}
        >
          <View className={styles.recDot} />
          <View className={styles.tileBody}>
            <Text className={`${styles.tileTitle} ${styles.tileTitleLight}`}>开始巡检</Text>
            <Text className={`${styles.tileDesc} ${styles.tileDescLight}`}>GPS 轨迹 · 5m 间隔抽帧</Text>
          </View>
          <Text className={`${styles.tileArrow} ${styles.tileArrowLight}`}>›</Text>
        </View>
      </View>
    </View>
  )
}
