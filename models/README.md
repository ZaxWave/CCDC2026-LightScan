# 📂 Models Directory

本目录用于存放项目所需的 YOLO 权重文件（`.pt`）。

## 当前使用的模型
* **yolo11n.pt**: 官方预训练权重（COCO 数据集）。用于基础环境测试及车辆/行人检测。
* **[待定模型]**: 计划后续加入针对道路缺陷（Crack, Pothole）微调后的模型。

## 如何获取权重
如果该目录下缺少模型文件，请执行以下任一操作：

1. **自动下载**：
   运行推理脚本时，Ultralytics 会自动尝试下载官方模型。
   ```powershell
   yolo predict model=models/yolo11n.pt source=...
    ```
2. **手动下载**：
   从 Ultralytics GitHub Releases：https://github.com/ultralytics/assets/releases 获取。
   下载后将 `.pt` 文件放置于 `models/` 目录下。