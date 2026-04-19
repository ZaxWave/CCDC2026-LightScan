export default {
  pages: [
    'pages/index/index',
    'pages/login/index',
    'pages/citizen/report/index',
    'pages/worker/list/index',
    'pages/worker/issues/index',
    'pages/worker/record/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'LightScan',
    navigationBarTextStyle: 'black'
  },
  permission: {
    'scope.userLocation': {
      desc: 'LightScan 需要获取您的位置用于路面病害坐标记录'
    },
    'scope.camera': {
      desc: 'LightScan 需要摄像头用于路面巡检录像'
    },
    'scope.record': {
      desc: 'LightScan 需要麦克风用于录像'
    }
  },
  requiredPrivateInfos: ['getLocation', 'onLocationChange']
}
