# dashcam-sampler

**LightScan · 轻巡智维** 数据预处理工具 — 行车记录仪视频按行驶距离均匀抽帧

---

## 简介

传统按时间间隔抽帧在低速或停车场景下会产生大量重复帧，在高速场景下又会漏采关键病害区域。本工具通过 OCR 识别视频中叠加的速度信息，将速度对时间积分换算为行驶距离，确保每隔固定距离（默认 5 米）保存一张图像，为后续病害检测模型提供**空间均匀分布**的输入样本。

### 工作原理

```
每隔 N 帧 OCR 识别速度（km/h）
        ↓
速度 × 帧时长 → 本帧行驶距离
        ↓
累计距离达到阈值 → 抽出并保存该帧
```

OCR 失败时自动沿用上一次识别到的速度（前向填充），保证积分连续性。

---

## 环境依赖

Python 3.9+，依赖会在首次运行时自动安装。也可手动安装：

```bash
pip install opencv-python paddleocr paddlepaddle
```


- `opencv-python`
- `paddleocr`
- `paddlepaddle`

---

## 用法

```bash
python3 extract_frames.py --input <视频路径> --output <输出根目录>
```

每次运行会在输出根目录下自动创建子目录，命名格式为 `视频文件名_YYYYMMDD_HHMMSS/`，多次运行互不干扰。

### 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--input` | 必填 | 输入视频文件路径（.mp4） |
| `--output` | 必填 | 输出根目录，结果保存在其下的自动命名子目录中 |
| `--distance` | `5.0` | 抽帧间距（米） |
| `--ocr-interval` | `15` | 每隔多少帧执行一次 OCR（30fps 下约 0.5 秒/次） |
| `--playback-speed` | `1.0` | 视频播放倍速，加速视频需填入对应倍数以还原真实时间 |
| `--max-duration` | 无限制 | 只处理视频前 N 秒 |
| `--ocr-region` | 自动检测 | 速度文字的裁剪区域，格式 `x1,y1,x2,y2`（像素坐标） |

### 示例

```bash
# 标准用法，自动定位速度文字区域
python3 extract_frames.py --input dashcam.mp4 --output frames/

# 只处理前 5 分钟
python3 extract_frames.py --input dashcam.mp4 --output frames/ --max-duration 300

# 1.5 倍速录像（需还原真实行驶距离）
python3 extract_frames.py --input dashcam_1.5x.mp4 --output frames/ --playback-speed 1.5

# 每 10 米抽一帧
python3 extract_frames.py --input dashcam.mp4 --output frames/ --distance 10

# 手动指定速度区域（速度显示在右下角时）
python3 extract_frames.py --input dashcam.mp4 --output frames/ --ocr-region "1300,900,1920,1080"
```

---

## 输出

```
输出目录/
├── frame_0001_dist_0m.jpg
├── frame_0002_dist_5m.jpg
├── frame_0003_dist_10m.jpg
├── ...
└── extracted_frames.csv
```

CSV 字段：

| 字段 | 说明 |
|------|------|
| `frame_index` | 原始帧序号 |
| `timestamp_s` | 对应视频时间（秒） |
| `speed_kmh` | 该帧识别到的速度（km/h） |
| `cumulative_distance_m` | 抽帧时的累计行驶距离（米） |

---

## OCR 区域自动检测

不传 `--ocr-region` 时，工具将视频均匀采样的若干帧切分为 3×3 小块分别做 OCR，自动定位包含 `KM/H` 字样的文字框并打印检测到的坐标。若自动检测失败（视频无速度叠加或格式特殊），程序会报错提示改用 `--ocr-region` 手动指定。

---

## 在 LightScan 中的位置

```
原始行车记录仪视频
        ↓
  dashcam-sampler          ← 本工具
（按距离均匀抽帧）
        ↓
  空间均匀分布的帧图像
        ↓
  LightScan 病害检测模型
```

---

© 2026 LightScan Team. Licensed under Apache 2.0.
