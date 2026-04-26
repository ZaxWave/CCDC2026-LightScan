# 🛣️ LightScan · 轻巡智维

> 面向城市公路养护的全链路道路病害智能巡检系统

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![PyTorch](https://img.shields.io/badge/Framework-PyTorch-EE4C2C?logo=pytorch&logoColor=white)](https://pytorch.org/)
[![LS-Det](https://img.shields.io/badge/Algorithm-LS--Det%20v1-00FFFF?logo=pytorch&logoColor=black)](#)
[![Taro](https://img.shields.io/badge/Mobile-Taro%204-0052D9?logo=react&logoColor=white)](https://taro.zone/)
[![Build](https://img.shields.io/badge/CCDC%202026-v1.0-orange)](#)

本项目为 **2026 年（第 19 届）中国大学生计算机设计大赛（4C）** 参赛作品。

---

## 📋 一、项目简介

**LightScan（轻巡智维）** 是一套面向城市公路养护的 **全链路道路病害智能巡检系统**，覆盖从病害采集、AI 识别、GIS 管理到移动端众包上报的完整业务闭环。

### 核心能力

| 模块 | 技术栈 | 核心能力 |
|------|--------|----------|
| 🧠 算法核心 | LS-Det v1 + SAHI | 4 类病害实时检测，18ms/帧，支持 SAHI 自适应切片；ReID 特征聚类追踪同一病害演化 |
| ⚙️ 后端服务 | FastAPI + PostgreSQL | 推理 API、GIS 工单全生命周期管理、JWT 鉴权、时空聚类、DeepSeek AI 派单 |
| 🖥️ Web 前端 | React 18 + Vite | 图片/视频检测、高德地图 GIS（散点/热力/健康评分三模式）、暗色模式、PWA 离线安装、键盘快捷键、修复前后对比图库 |
| 📱 移动端 | Taro 4 + React | 微信小程序 + H5，市民随手拍 & 巡检员工作台 |
| 📱 安卓端 | React Native + Expo | 原生安卓 App，引导页 Onboarding、GPS 轨迹记录、工单接单/完工闭环 |

### 训练数据

LS-Det 在三个公开数据集上进行全量训练，共 **20,500 张**标注图像：

| 数据集 | 子集 / 来源 | 数量 |
|--------|------------|------|
| [RDD2022](https://arxiv.org/abs/2209.08538) — Japan | 日本道路 | 10,500 张 |
| RDD2022 — China_Motorbike | 中国摩托车行车视角 | 1,977 张 |
| SVRDD v1 | 北京街景道路病害数据集 | 8,000 张 |
| **合计** | 训练集 / 验证集 = 8:2 | **20,500 张** |

类别定义（4 类）：`D00` 纵向裂缝 · `D10` 横向裂缝 · `D20` 龟裂 · `D40` 坑槽

**训练配置**：
- 输入分辨率：960×960
- box_loss 权重：7.5
- 配置训练轮数：180 epochs
- 早停策略：patience = 40（连续 40 轮验证 mAP 无提升则终止）
- **实际训练轮数**：148 epochs（epoch 142 触发早停）
- **最佳验证结果**：epoch 142，mAP@0.5 = 0.692
- 硬件：RTX 4090D
- **实际训练时间**：约 6.67 小时（24,003 秒）

**训练结果文件**：`models/lightscan_model_yolo11s/`
- 训练曲线、混淆矩阵：见该目录下图片
- 详细训练日志：`results.csv`
- 超参数配置：`models/lsdet_hparams.yaml`
- 数据集说明：`datasets/README.md`

---

## 🏗️ 二、系统架构

```
市民 / 巡检员（移动端 WeChat / H5）
        │  上报病害照片、接收工单
        ▼
   FastAPI 后端（:8000）
   ├── LS-Det v1 推理引擎（+ SAHI 自适应切片增强）
   ├── PaddleOCR → 视频帧速度识别 + 里程积分定位
   ├── 时空约束 + 视觉 ReID 融合聚类算法
   ├── PostgreSQL + PostGIS（users / disease_clusters / disease_records / audit_log / disease_media）
   ├── DeepSeek AI → 巡检周报 + 单点养护建议 + AI 派单工单
   └── JWT 鉴权 + 工单状态流转
        │  REST API
        ▼
  React 18 Web 前端（:5173 / 由 FastAPI 托管）
  ├── 图片 / 视频检测面板
  ├── 高德地图 GIS 病害大屏
  └── ECharts 3D 态势感知大屏
```

---

## 📁 三、文件结构

```text
CCDC2026-LightScan/
├── train.py                    # LS-Det v1 训练入口
├── inference.py                # SAHI 推理引擎（单张 / 批量）
├── improve.py                  # 微调脚本（关闭增强 + 极低学习率）
├── resume.py                   # 断点续训入口
├── args.yaml                   # 训练超参数（备用，train.py 优先读 lsdet_hparams.yaml）
├── requirements.txt            # Python 依赖清单
│
├── assets/                     # 测试样图（defect_test*.jpg 等）
│
├── models/
│   ├── lsdet.py                # LS-Det v1 网络结构 PyTorch 实现
│   ├── lsdet_arch.yaml         # 网络层级配置（骨干 / FPN+PAN / 解耦头）
│   ├── lsdet_hparams.yaml      # 训练超参数（含寻优依据注释）
│   ├── yolo11s.pt              # 预训练基础权重（仅用于参数初始化）
│   └── weights/
│       ├── best.pt             # LS-Det v1 最优权重（epoch 142）
│       └── last.pt             # 最后一次 epoch 检查点
│
├── datasets/
│   ├── road_defect.yaml        # 数据集配置（4 类病害）
│   └── RDD2022_lsdet/          # 转换后训练格式（11,753 张）
│       ├── images/train/       # 训练集 9,403 张
│       └── images/val/         # 验证集 2,350 张
│
├── data/                       # 运行时数据目录（git 仅保留占位符）
│   ├── raw/                    # 原始行车记录仪视频
│   ├── processed/              # 抽帧 / 预处理后图像
│   ├── labels/                 # 标注文件暂存
│   └── temp/                   # 推理临时文件
│
├── src/
│   ├── backend/                # FastAPI 后端
│   │   └── app/
│   │       ├── main.py         # 服务入口 + CORS + 热迁移
│   │       ├── api/
│   │       │   ├── deps.py     # 依赖注入（JWT 解析、DB Session）
│   │       │   └── v1/
│   │       │       ├── auth.py
│   │       │       ├── detect.py
│   │       │       ├── detect_video.py
│   │       │       ├── gis.py
│   │       │       ├── report.py       # 移动端众包上报
│   │       │       ├── users.py
│   │       │       └── ai_report.py    # DeepSeek 巡检周报 & 养护建议
│   │       ├── services/
│   │       │   ├── inference_service.py   # LS-Det + SAHI 推理
│   │       │   ├── video_service.py       # 视频帧处理 + OCR 里程定位
│   │       │   ├── clustering_service.py  # 时空 + ReID 融合聚类
│   │       │   ├── geo_service.py         # GIS 坐标转换
│   │       │   └── ai_report_service.py   # DeepSeek 调用 + Prompt 工程
│   │       ├── db/
│   │       │   ├── database.py   # SQLAlchemy 引擎 + Session
│   │       │   └── models.py     # ORM（User / DiseaseCluster / DiseaseRecord / AuditLog / DiseaseMedia）
│   │       ├── schemas/
│   │       │   ├── disease.py    # Pydantic 病害 Schema
│   │       │   └── user.py       # Pydantic 用户 Schema
│   │       └── core/
│   │           └── security.py   # JWT 签发 + bcrypt 密码哈希
│   │
│   ├── frontend/               # React 18 + Vite Web 端
│   │   └── src/
│   │       ├── main.jsx        # 应用入口
│   │       ├── App.jsx         # 路由根组件
│   │       ├── panels/         # 页面级面板
│   │       │   ├── LoginPanel.jsx
│   │       │   ├── ImagePanel.jsx
│   │       │   ├── VideoPanel.jsx
│   │       │   ├── MapPanel.jsx
│   │       │   ├── DashboardPanel.jsx    # 3D 态势感知大屏
│   │       │   ├── MyRecordsPanel.jsx
│   │       │   └── AboutPanel.jsx
│   │       ├── components/     # 通用 UI 组件
│   │       │   ├── Nav.jsx
│   │       │   ├── WeeklyReportModal.jsx # AI 周报弹窗
│   │       │   ├── map/        # 地图图层（Cluster / Heatmap / Timeline）
│   │       │   └── video/      # 视频检测弹窗、区域画布
│   │       ├── context/        # React Context（网络状态、Toast）
│   │       ├── api/
│   │       │   ├── client.js   # 请求封装（Token 注入、401 拦截）
│   │       │   └── auth.js
│   │       ├── utils/
│   │       │   └── offlineDB.js  # IndexedDB 离线缓存
│   │       └── styles/
│   │           └── variables.css # 全局 CSS 变量
│   │
│   └── mobile/                 # Taro 4 移动端（微信小程序 + H5）
│       ├── src/
│       │   ├── app.jsx         # Taro 应用根组件
│       │   ├── app.config.js   # 全局路由 / 窗口配置
│       │   ├── app.scss        # 全局样式基线
│       │   ├── index.html      # H5 HTML 模板
│       │   └── pages/
│       │       ├── index/            # 身份选择首页（市民 / 巡检员）
│       │       ├── login/            # 巡检员登录
│       │       ├── citizen/report/   # 市民随手拍上报
│       │       └── worker/list/      # 巡检员工单工作台
│       ├── config/
│       │   ├── index.js        # Taro webpack5 主配置
│       │   ├── dev.js          # 开发环境覆盖
│       │   └── prod.js         # 生产环境覆盖
│       ├── project.config.json
│       └── package.json
│
├── tools/
│   ├── dashcam_sampler/        # 行车记录仪按距离抽帧工具
│   │   └── extract_frames.py
│   └── convert_voc_to_yolo.py  # RDD2022 VOC → LS-Det 训练格式转换
│
└── docs/                       # 项目文档
    ├── research/               # 行业调研报告
    ├── resources/              # 参考论文（PDF）
    ├── technical/              # 技术文档
    ├── notices/                # 赛事通知文件
    └── templates/              # 参赛材料模板
```

---

## 🚀 四、环境搭建与运行

### 4.1 Python 环境（算法 + 后端）

```bash
conda create -n lightscan python=3.11 -y
conda activate lightscan
```

**安装 PyTorch（按显卡型号选择）：**

```bash
# RTX 50 系列 Blackwell（须用 Nightly）
pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128

# RTX 40 系列及以下
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

```bash
pip install -r requirements.txt
```

### 4.2 数据库

```bash
createdb lightscan
```

在 `src/backend/` 新建 `.env`：

```env
DATABASE_URL=postgresql://用户名:密码@localhost:5432/lightscan
SECRET_KEY=your-secret-key-here
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 4.3 启动后端

```bash
conda activate lightscan
cd src/backend
uvicorn app.main:app --reload --port 8000
# API 文档：http://localhost:8000/docs
```

> 首次使用视频 OCR 模式时，PaddleOCR 将自动下载约 130 MB 模型文件。

### 4.4 Web 前端

在 `src/frontend/` 新建 `.env`，填入高德地图密钥：

```env
VITE_AMAP_KEY=你的高德Key
VITE_AMAP_SECURITY_CODE=你的安全密钥
```

```bash
cd src/frontend
npm install
npm run dev        # 开发模式 → http://localhost:5173
npm run build      # 生产构建 → 产物由 FastAPI 静态托管
```

### 4.5 移动端（微信小程序 / H5）

```bash
cd src/mobile   
npm install

# H5 开发预览（浏览器 F12 切手机模式）
npm run dev:h5
# 访问 http://localhost:10086

# 微信小程序构建
npm run build:weapp
# 用微信开发者工具导入 dist/weapp/，点「预览」扫码真机测试
```

> **注意**：微信开发者工具调试基础库请选择稳定版（建议 3.4.x），灰度版 3.15.x 存在已知超时兼容问题。

### 4.6 安卓原生端（React Native + Expo）

```bash
cd src/android
npm install

# 开发模式（需要 Android Studio + JDK 17+）
npm start
# 按 `a` 键在 Android 设备上运行

# 生产构建（APK）
eas build --platform android --profile preview
```

**前置要求**：
- Android Studio 2023.1+
- JDK 17+
- 设备启用开发者选项 + USB 调试

**配置**：
- 摄像头权限：在 app.json 中已配置 expo-camera 权限声明
- GPS 定位：使用 expo-location
- 屏幕方向：使用 expo-screen-orientation

---

## 🧠 五、模型训练

```bash
# 启动 LS-Det v1 训练（读取 models/lsdet_hparams.yaml）
python train.py

# 快速冒烟验证（2 轮）
python train.py --smoke-test

# 单张 / 批量推理（SAHI 自适应切片）
python inference.py --source path/to/image_or_video
```

训练完成后将 `runs/train/lsdet_v1/weights/best.pt` 复制到 `models/weights/best.pt`。

---

## 🔌 六、主要 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/auth/login` | 登录，返回 JWT Token |
| `POST` | `/api/v1/detect` | 图片推理（最多 20 张） |
| `POST` | `/api/v1/detect-video` | 视频推理（OCR / 里程估算模式） |
| `GET`  | `/api/v1/gis/records` | 获取全平台 GIS 病害记录 |
| `PATCH`| `/api/v1/gis/records/{id}/status` | 工单状态流转（待处理→处理中→已完成） |
| `GET`  | `/api/v1/gis/clusters/{id}/timeline` | 病害点演变时间轴 |
| `POST` | `/api/v1/ai/report` | DeepSeek 生成辖区巡检周报 |
| `POST` | `/api/v1/ai/cluster/{id}/advice` | DeepSeek 生成单点养护建议 |
| `POST` | `/api/v1/disease/dispatch/{id}` | AI 生成维修工单并派发 |
| `GET`  | `/api/v1/disease/orders` | 获取已派发工单列表（移动端） |
| `PATCH`| `/api/v1/disease/orders/{id}/status` | 巡检员接单 / 标记完工 |

完整交互式文档：启动后端后访问 `http://localhost:8000/docs`。

---

## 📄 七、开源声明

| 组件 | 许可证 |
|------|--------|
| [Ultralytics](https://github.com/ultralytics/ultralytics)（训练框架） | AGPL-3.0 |
| [SAHI](https://github.com/obss/sahi) 切片推理 | MIT |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache 2.0 |
| [FastAPI](https://fastapi.tiangolo.com/) | MIT |
| [Taro 4](https://taro.zone/) | MIT |
| React 18、Vite、ECharts、高德地图 JS API 2.0 | 各自许可证 |

本项目系统架构、业务逻辑及文档均为团队原创，采用 **Apache License 2.0** 开源。AI 辅助工具使用情况已在《作品信息摘要》中如实标注。

---

© 2026 LightScan Team · All Rights Reserved
