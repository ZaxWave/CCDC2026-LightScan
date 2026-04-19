# 📁 Datasets Directory

此目录用于存放 LS-Det 模型训练数据集。

## 📊 数据集使用状态

### 当前使用（合并数据集）

| 数据集 | 来源格式 | 样本量 | 说明 |
| :--- | :--- | ---: | :--- |
| **RDD2022** Japan | VOC XML | ~10,500 张 | 日本路面，标注质量高 |
| **RDD2022** China_MotorBike | VOC XML | ~1,977 张 | 中国摩托车视角 |
| **SVRDD v1** | YOLO 7类 | ~8,000 张 | 北京街景道路病害数据集 |

合并输出至 `merged/`，共约 **20,500** 张，按 8:2 划分 train/val。

类别定义（4 类，统一标准）：`D00` 纵向裂缝 · `D10` 横向裂缝 · `D20` 龟裂 · `D40` 坑槽

SVRDD 类别映射：Alligator Crack→D20 · Longitudinal Crack→D00 · Transverse Crack→D10 · Pothole→D40
忽略类别：Longitudinal Patch · Transverse Patch · Manhole Cover

合并脚本：`tools/merge_datasets.py` · 数据集配置：`merged/data.yaml`

## 📦 备用数据集（未使用）

| 数据集 | 说明 |
| :--- | :--- |
| **RDD2022** India | 印度路面，场景差异大，可作后续扩展 |
| **CNRDD** | 符合中国《公路技术状况评定标准》(JTG 5210)，国内路损标准对齐 |
| **GAPs** | 德国专业级高分辨率路面影像，适合精细裂缝基准测试 |
| **Crack500** | 专注裂缝，适合语义分割或细粒度分类研究 |

> **⚠️ 注意**：所有图像与标注文件均已通过 `.gitignore` 排除在版本控制之外。

---

© 2026 LightScan Team. Licensed under Apache 2.0.
