# 🛣️ LightScan：轻巡智维 —— 道路病害轻量化智能巡检系统

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Framework](https://img.shields.io/badge/Framework-PyTorch-EE4C2C?logo=pytorch&logoColor=white)](https://pytorch.org/)
[![Build](https://img.shields.io/badge/Build-Passing-brightgreen.svg)](#)

本项目为 **2026年（第19届）中国大学生计算机设计大赛 (4C)** 参赛作品。

---

## 📖 1. 项目定位 (Project Positioning)

* **项目名称**：轻巡智维 (LightScan)
* **作品编号**：2026017676
* **核心背景**：针对我国公路网从“大规模建设”向“高质量养护”转型的战略需求，研发的一套兼容普适性感知设备的道路病害智能检测系统。
* **技术价值**：通过提升边缘侧计算效率与算法鲁棒性，实现低成本、高频次、全覆盖的数字化巡检，为智慧交通“精细化养护”提供技术闭环。

---

## 📂 2. 文件结构声明 (Project Structure)

本项目采用“**产物与源码分离**”的工程化管理逻辑。根目录下的四个数字文件夹严格遵循大赛交付规范。

```text
CCDC2026/ 
├── .gitignore                          # Git 忽略配置
├── README.md                           # 项目主说明文档
├── LICENSE                             # Apache 2.0 许可证
├── requirements.txt                    # 全局运行环境依赖清单
├── docs/                               # 说明文档与技术积淀
├── models/                             # 核心算法模型及权重
├── assets/                             # 开发素材
│
├── src/                                # 🛠️ 研发源代码主体
│   ├── api/                            # 后端服务逻辑层
│   │   ├── core/                       # 算法推理调度核心
│   │   └── server.py                   # 系统服务入口
│   ├── web/                            # 前端交互展示层
│   │   ├── public/                     # 公共静态资源
│   │   └── src/                        # UI 组件与页面逻辑
│   └── utils/                          # 通用工具函数库
│
├── 2026017676-01作品与答辩材料/         # 📦 最终产物与演示材料
├── 2026017676-02素材与源码/             # 📦 源码包与代表性素材
├── 2026017676-03设计与开发文档/         # 📦 官方技术与设计报告
└── 2026017676-04作品展示视频/           # 📦 演示视频 (MP4)
````

-----

## 📑 3. 研发规范与状态 (Development Standards)

  * **版本管理**：使用 Git 进行版本控制。大型二进制资产（模型权重、超清视频、数据集）不计入版本库，通过 **Release** 附件或官方指定网盘分发。
  * **架构原则**：采用前后端解耦架构。`src/` 目录仅保留纯粹逻辑实现，确保代码符合 PEP 8 风格指南。

-----

## ⚖️ 4. 法律与合规声明 (Compliance)

> [\!IMPORTANT]
> **原创性声明**：本项目除引用必要开源组件外，系统架构、核心算法逻辑及相关文档均为团队成员原创。

  * **AI 辅助声明**：如涉及使用 AIGC 工具辅助开发，将按照大赛要求在《作品信息摘要》中如实标注工具名称及生成内容占比。
  * **数据合规**：项目测试数据来源合法，不涉及敏感地理信息或个人隐私，符合国家数据安全相关规定。
  * **授权协议**：本项目采用 [Apache License 2.0](https://www.google.com/search?q=LICENSE) 协议开源。

-----

© 2026 LightScan Team. All Rights Reserved.
