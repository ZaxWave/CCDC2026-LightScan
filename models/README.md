# 📂 Models Directory

本目录用于存放项目所需的 YOLO 权重文件（`.pt`）。

## 目录结构

```
models/
├── yolo11n.pt          # YOLO11n 官方预训练权重（COCO），用于微调的初始权重
├── yolo26n.pt          # Ultralytics AMP 验证时自动下载的辅助权重
└── weights/
    └── best.pt         # 在 RDD2022 上微调后的最优权重（训练完成后从 runs/ 复制至此）
```

## 权重说明

* **yolo11n.pt**：Ultralytics 官方预训练权重（COCO 80 类），作为道路病害微调的骨干起点。
* **weights/best.pt**：在 RDD2022（Japan + China_MotorBike + China_Drone）上微调得到的最优模型，供 `inference.py` 和后端服务直接调用。

## 训练完成后更新权重

正式训练结束后，将最优权重复制到此目录：

```powershell
copy runs\train\lightscan_exp\weights\best.pt models\weights\best.pt
```

---

© 2026 LightScan Team. Licensed under Apache 2.0.
