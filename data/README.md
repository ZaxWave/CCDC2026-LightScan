# 📁 Data Directory

# LightScan Data Storage

本目录用于存放项目运行所需的视频原始素材、预处理结果及中间产物。

## 目录结构
- `raw/`: 存放原始行车记录仪视频（.mp4, .mov）。
- `processed/`: 存放经由 `tools/dashcam_sampler` 处理后的均匀距离采样图片。
- `labels/`: 存放病害检测的标注文件（YOLO 格式）。
- `temp/`: 运行时的临时缓存。

## 注意事项
1. **Git 忽略**：由于视频和图片体积较大，本目录下的所有大文件已通过 `.gitignore` 忽略，请勿强制上传至 GitHub。
2. **数据清理**：建议定期清理 `temp/` 目录以释放磁盘空间。
3. **命名规范**：原始视频建议以 `YYYYMMDD_地点_编号.mp4` 命名。