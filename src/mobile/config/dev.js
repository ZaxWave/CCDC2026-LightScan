module.exports = {
  env: {
    NODE_ENV: '"development"',
    TARO_APP_API_URL: '"http://localhost:8000"',
  },
  defineConstants: {},
  mini: {
    // 关闭 source-map 减小 bundle 体积，缓解 timeout
    enableSourceMap: false,
  },
  h5: {}
}
