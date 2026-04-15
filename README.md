# 🛣️ LightScan：轻巡智维 —— 道路病害轻量化智能巡检系统

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![PyTorch](https://img.shields.io/badge/Framework-PyTorch-EE4C2C?logo=pytorch&logoColor=white)](https://pytorch.org/)
[![YOLOv11](https://img.shields.io/badge/Algorithm-YOLOv11-00FFFF?logo=ultralytics&logoColor=black)](https://github.com/ultralytics/ultralytics)
[![Build](https://img.shields.io/badge/CCDC%202026-v1.0--alpha-orange)](#)

本项目为 **2026年（第19届）中国大学生计算机设计大赛 (4C)** 参赛作品。

---

## 📖 1. 项目概览 (Project Overview)

### 1.1 基本信息
* **作品名称**：轻巡智维 (LightScan)
* **作品编号**：2026017676
* **应用领域**：智慧交通、道路自动化养护

### 1.2 技术架构 (Technical Architecture)
本项目采用主流的深度学习感知与全栈 Web 开发架构：
* **算法核心**：采用 **YOLOv11** 目标检测框架，兼顾实时检测速率与复杂环境下的识别精度。
* **后端支撑**：选用 **FastAPI** 异步框架，通过高并发处理能力确保推理接口的响应速度。
* **前端展示**：基于 **React 18 + Vite** 的组件化单页应用，CSS Modules 管理样式，实现响应式布局与检测结果的实时渲染。

---

## 📂 2. 文件结构声明 (Project Structure)

本项目采用“**产物与源码分离**”的工程化管理逻辑，严格遵循大赛交付规范。

```text
CCDC2026-LightScan/
├── train.py                            # 🚀 核心训练入口
├── inference.py                        # 🚀 核心推理引擎
├── args.yaml                           # 训练/推理参数配置
├── .gitignore                          # Git 忽略配置
├── README.md                           # 项目主说明文档
├── LICENSE                             # Apache 2.0 许可证
├── requirements.txt                    # 全局运行环境依赖清单
├── assets/                             # 开发素材
├── data/                               # 数据目录（原始素材、预处理结果、中间产物）
│
├── datasets/                           # 数据集
│   ├── road_defect.yaml                # Ultralytics 数据集配置（4 类病害）
│   ├── RDD2022_yolo/                   # 转换后的 YOLO 格式数据（已生成，共 11,753 张）
│   │   ├── images/train/               # 训练集图片（9,403 张）
│   │   ├── images/val/                 # 验证集图片（2,350 张）
│   │   ├── labels/train/               # 训练集标注
│   │   └── labels/val/                 # 验证集标注
│   ├── Japan/                          # RDD2022 原始数据（VOC 格式，git 忽略）
│   ├── China_MotorBike/                # RDD2022 原始数据（VOC 格式，git 忽略）
│   └── China_Drone/                    # RDD2022 原始数据（VOC 格式，git 忽略）
│
├── docs/                               # 说明文档与技术积淀
│   ├── research/                       # 调研文档
│   ├── requirements/                   # 作品要求
│   ├── technical/                      # 技术文档
│   ├── notices/                        # 通知文档
│   └── resources/                      # 参考资料
│
├── models/                             # 核心算法模型及权重
│   ├── yolo11n.pt                      # 官方预训练权重（微调起点）
│   └── weights/
│       └── best.pt                     # 微调后最优权重（训练完成后从 runs/ 复制）
│
├── runs/                               # 训练输出（git 忽略）
│   └── train/
│       └── lightscan_exp/              # 正式训练结果
│
├── src/                                # 🛠️ 研发源代码主体
│   ├── backend/                        # 后端：FastAPI
│   │   └── app/                        # 应用主逻辑
│   │       ├── main.py                 # 服务入口（路由注册、CORS、静态文件挂载）
│   │       ├── api/v1/
│   │       │   ├── detect.py           # POST /api/v1/detect（图片推理）
│   │       │   ├── detect_video.py     # POST /api/v1/detect-video（视频推理）
│   │       │   └── gis.py              # POST /api/v1/gis（位置服务）
│   │       └── services/
│   │           ├── inference_service.py # YOLO 推理单例封装
│   │           ├── video_service.py    # 视频抽帧服务（OCR 距离 / 时间估算）
│   │           └── geo_service.py      # 位置分析服务
│   └── frontend/                       # 前端：React 18 + Vite
│       ├── src/                        # React 源码
│       │   ├── main.jsx                # 入口
│       │   ├── App.jsx                 # 根组件
│       │   ├── App.css                 # 根组件布局样式
│       │   ├── api/client.js           # API 封装（detectImages / detectVideo）
│       │   ├── components/             # 通用组件（Nav、Hero、TabBar、UploadArea 等）
│       │   │   └── video/              # 视频检测 Modal 与 Canvas 框选组件
│       │   ├── panels/                 # 页面面板（ImagePanel / VideoPanel）
│       │   └── styles/variables.css    # 全局 CSS 变量（设计系统）
│       ├── public/                     # 构建产物（FastAPI 托管目录）
│       ├── index.html                  # Vite 开发模板
│       ├── vite.config.js              # Vite 配置（outDir → public，代理 /api → 8000）
│       └── package.json
│
├── tools/                              # 🛠️ 独立工具链
│   └── dashcam_sampler/                # 行车记录仪按距离抽帧工具
└── submission/                         # 归档
    ├── 2026017676-01作品与答辩材料/
    ├── 2026017676-02素材与源码/
    ├── 2026017676-03设计与开发文档/
    └── 2026017676-04作品展示视频/

```

-----

## 🛠️ 3. 环境搭建 (Setup)

本项目推荐使用 **Python 3.11** 以获得最佳的性能与兼容性。

### 1) 创建虚拟环境 (Conda 推荐)
```powershell
# 创建环境
conda create -n lightscan python=3.11 -y
# 激活环境
conda activate lightscan
```

### 2) 安装 PyTorch（根据显卡选择）

> ⚠️ **Blackwell 架构用户必读**
> RTX 50 系列（Blackwell，sm_120）不在 PyTorch stable 支持范围内（最高 sm_90），
> **必须使用 Nightly 版本**，否则 GPU 加速无法正常启用。

**RTX 50 系列 / Blackwell（sm_120）→ 使用 Nightly：**
```powershell
pip install --pre torch torchvision --index-url https://download.pytorch.org/whl/nightly/cu128
```

**RTX 40 系列及以下 / 其他 NVIDIA 显卡 → 使用 Stable：**
```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

### 3) 安装其余依赖
```powershell
pip install -r requirements.txt
```

### 4) 验证环境
```PowerShell
# 检查 YOLO 版本
yolo version
# 检查 GPU 是否正常
python -c "import torch; print(torch.cuda.get_device_name(0))"
```

-----

## 🖥️ 4. 前端开发 (Frontend Dev)

前端基于 React 18 + Vite 构建，包含图像检测、视频分析与空间态势大屏三大模块。首次拉取项目后，请严格按以下步骤初始化：

### 1) 环境变量配置 (地图密钥)
本项目深度集成了高德地图 JS API 2.0。为了保证安全，密钥不会提交到代码库中。
请在 `src/frontend/` 目录下新建 `.env` 文件，并填入你在高德开放平台申请的 Web 端密钥：

```text
VITE_AMAP_KEY=你的高德地图Key
VITE_AMAP_SECURITY_CODE=你的高德安全密钥
```

### 2) 安装前端依赖
进入前端目录并执行安装命令：

```powershell
cd src/frontend
# 安装基础依赖 + 高德地图加载器 
npm install @amap/amap-jsapi-loader
# 安装 ECharts 依赖
npm install echarts echarts-for-react --save
# 如果遇到版本冲突（React 18 vs 19），请使用强制模式
npm install --legacy-peer-deps
```

### 3) 开发模式运行
支持热更新，并在 `vite.config.js` 中自动将 `/api` 请求代理至后端 8000 端口：

```powershell
npm run dev
# 运行成功后访问 → http://localhost:5173
```

### 4) 生产环境构建
当开发完成准备最终交付时，执行以下命令：

```powershell
npm run build
```
> 编译产物将自动输出到 `src/frontend/public/` 目录，由后端的 FastAPI 框架作为静态资源统一托管。

-----

## 🚀 5. 启动 Web 服务 (Run Server)

模型训练完成、权重就位后，执行以下命令启动推理服务：

```powershell
conda activate lightscan
cd src/backend
uvicorn app.main:app --reload --port 8000
```

服务启动后访问 `http://localhost:8000`，支持：
- **图片检测**：上传 JPG / PNG，返回标注图与病害类型
- **视频检测（OCR 模式）**：行车记录仪视频，自动识别速度字幕，按行驶距离均匀抽帧
- **视频检测（估算模式）**：无速度字幕视频，手动输入大致车速与抽帧间隔

**API 接口一览：**

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET`  | `/health` | 健康检查 |
| `POST` | `/api/v1/detect` | 图片推理（multipart，最多 20 张） |
| `POST` | `/api/v1/detect-video/first-frame` | 获取视频第一帧（用于手动框选速度区域） |
| `POST` | `/api/v1/detect-video` | 视频推理（ocr / timed 两种模式） |

> **注意**：首次使用视频 OCR 模式时，PaddleOCR 会从 HuggingFace 下载模型文件（约 130 MB），之后缓存复用。
> 如遇网络问题，可设置 `$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = "True"` 跳过来源校验。

-----

## 📑 6. 研发规范 (Development Standards)

  * **版本管理**：使用 Git 进行版本控制。大型二进制资产（模型权重、超清视频、数据集）不计入版本库，通过 **Release** 附件或官方指定网盘分发。
  * **架构原则**：采用前后端解耦架构。`src/` 目录仅保留纯粹逻辑实现，确保代码符合 PEP 8 风格指南。

-----

## ⚖️ 7. 法律与合规声明 (Compliance)

> [\!IMPORTANT]
> **原创性声明**：本项目除引用必要开源组件外，系统架构、核心算法逻辑及相关文档均为团队成员原创。

  * **AI 辅助声明**：如涉及使用 AIGC 工具辅助开发，将按照大赛要求在《作品信息摘要》中如实标注工具名称及生成内容占比。
  * **数据合规**：项目测试数据来源合法，不涉及敏感地理信息或个人隐私，符合国家数据安全相关规定。
  * **授权协议**：本项目采用 [Apache License 2.0](https://www.google.com/search?q=LICENSE) 协议开源。

-----

© 2026 LightScan Team. All Rights Reserved.
