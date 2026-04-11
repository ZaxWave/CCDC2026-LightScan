#!/usr/bin/env python3
"""
extract_frames.py

从行车记录仪视频中按行驶距离均匀抽帧。

核心逻辑：
  每隔 --ocr-interval 帧对速度区域做一次 OCR，识别当前速度（km/h）。
  两次 OCR 之间的帧用最近一次识别到的速度做前向填充。
  每帧将速度积分换算成行驶距离，累计距离达到阈值时抽出该帧。

依赖会在首次运行时自动安装，无需手动 pip install。
"""

import argparse
import csv
import datetime
import importlib.util
import os
import re
import subprocess
import sys


def _install_if_missing():
    """首次运行时自动安装缺失的依赖，无需手动 pip install。"""
    packages = [
        ("cv2",       "opencv-python-headless"),
        ("paddleocr", "paddleocr"),
        ("paddle",    "paddlepaddle"),
    ]
    missing = [pip_name for mod_name, pip_name in packages
               if importlib.util.find_spec(mod_name) is None]
    if missing:
        print(f"首次运行，正在安装依赖：{' '.join(missing)}")
        subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing)
        print("依赖安装完成。\n")


_install_if_missing()

import cv2
from paddleocr import PaddleOCR


# ---------------------------------------------------------------------------
# 命令行参数
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="按行驶距离均匀抽帧（从行车记录仪视频 OCR 速度信息）"
    )
    parser.add_argument("--input", required=True, help="输入视频文件路径（.mp4）")
    parser.add_argument("--output", required=True, help="输出帧图像的目录")
    parser.add_argument(
        "--distance", type=float, default=5.0,
        help="每隔多少米抽一帧，默认 5.0"
    )
    parser.add_argument(
        "--ocr-interval", type=int, default=15,
        help="每隔多少帧做一次 OCR，默认 15（30fps 下约 0.5 秒一次）"
    )
    parser.add_argument(
        "--max-duration", type=float, default=None,
        help="只处理视频前 N 秒，不传则处理全片"
    )
    parser.add_argument(
        "--playback-speed", type=float, default=1.0,
        help="视频播放倍速，默认 1.0。若视频经过加速处理（如 1.5x、2x），"
             "需在此填入对应倍数，以还原真实行驶时间。"
    )
    parser.add_argument(
        "--ocr-region", default=None,
        help="OCR 裁剪区域，格式 'x1,y1,x2,y2'（像素坐标）。"
             "不传则自动从前几帧检测速度文字位置。"
    )
    return parser.parse_args()


def parse_ocr_region(region_str):
    """把 '0,720,600,800' 解析成 (x1, y1, x2, y2) 整数元组。"""
    try:
        x1, y1, x2, y2 = [int(v.strip()) for v in region_str.split(",")]
        return x1, y1, x2, y2
    except ValueError:
        sys.exit(
            f"错误：--ocr-region 格式应为 'x1,y1,x2,y2'（四个整数），收到：{region_str}"
        )


def auto_detect_speed_region(cap, ocr_engine, probe_frames=5, padding=20):
    """
    对前几帧跑全图 OCR，找包含 KM/H 的文字框，返回 (x1, y1, x2, y2)。
    找不到则返回 None。
    """
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    # 均匀取 probe_frames 帧（首帧、末帧、中间帧）
    indices = [int(total * i / (probe_frames - 1)) for i in range(probe_frames)]

    boxes = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            continue
        h, w = frame.shape[:2]
        # 把帧切成 3×3 的小块分别 OCR，避免全图时小字被忽略
        rows, cols = 3, 3
        for ri in range(rows):
            for ci in range(cols):
                y0 = ri * h // rows
                y1_ = (ri + 1) * h // rows
                x0 = ci * w // cols
                x1_ = (ci + 1) * w // cols
                tile = frame[y0:y1_, x0:x1_]
                try:
                    result = ocr_engine.ocr(tile)
                except Exception:
                    continue
                for page in (result or []):
                    if not isinstance(page, dict):
                        continue
                    for text, score, poly in zip(
                        page.get("rec_texts", []),
                        page.get("rec_scores", []),
                        page.get("rec_polys", []),
                    ):
                        if score > 0.3 and re.search(r"\d+\s*[KX]M.?H", text, re.IGNORECASE):
                            pts = poly.reshape(-1, 2)
                            boxes.append((
                                x0 + int(pts[:, 0].min()),
                                y0 + int(pts[:, 1].min()),
                                x0 + int(pts[:, 0].max()),
                                y0 + int(pts[:, 1].max()),
                                w, h,
                            ))

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # 重置到开头

    if not boxes:
        return None

    # 取所有检测框的并集，再加 padding
    x1 = max(0, min(b[0] for b in boxes) - padding)
    y1 = max(0, min(b[1] for b in boxes) - padding)
    x2 = min(boxes[0][4], max(b[2] for b in boxes) + padding)
    y2 = min(boxes[0][5], max(b[3] for b in boxes) + padding)
    return x1, y1, x2, y2


# ---------------------------------------------------------------------------
# OCR 速度解析
# ---------------------------------------------------------------------------

def extract_speed_kmh(ocr_result):
    """
    从 PaddleOCR 结果中提取速度数值（km/h）。

    视频左下角格式示例：'012KM/H N:30.7109 E:104.0214'
    支持的变体：'60KM/H'、'60 KM/H'、'60KMH'、'60 km/h'

    返回 float 速度，识别失败返回 None。
    """
    if not ocr_result:
        return None

    # 新版 PaddleOCR 返回 List[dict]，每个 dict 有 rec_texts / rec_scores
    texts = []
    for page in ocr_result:
        if not isinstance(page, dict):
            continue
        for text, score in zip(page.get("rec_texts", []), page.get("rec_scores", [])):
            if score > 0.3:
                texts.append(text)
    if not texts:
        return None
    full_text = " ".join(texts)

    # 优先匹配 KM/H（K 有时被 OCR 误读为 X）
    match = re.search(r"(\d+)\s*[KX]M.?H", full_text, re.IGNORECASE)
    if match:
        return float(match.group(1)), "kmh"

    # 其次匹配 MPH
    match = re.search(r"(\d+)\s*MPH", full_text, re.IGNORECASE)
    if match:
        return float(match.group(1)), "mph"

    return None, None


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main():
    args = parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"错误：找不到输入文件 {args.input}")

    stem = os.path.splitext(os.path.basename(args.input))[0]
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = os.path.join(args.output, f"{stem}_{timestamp}")
    os.makedirs(output_dir, exist_ok=True)
    print(f"输出目录：{output_dir}")

    print("正在初始化 PaddleOCR……")
    ocr_engine = PaddleOCR(use_textline_orientation=False, lang="en")

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        sys.exit(f"错误：无法打开视频文件 {args.input}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    seconds_per_frame = args.playback_speed / fps
    max_frames = int(args.max_duration * fps) if args.max_duration else total_frames

    if args.ocr_region:
        x1, y1, x2, y2 = parse_ocr_region(args.ocr_region)
        print(f"OCR 区域（手动）：x=[{x1},{x2}]  y=[{y1},{y2}]")
    else:
        print("正在自动检测速度文字位置（扫描前几帧）……")
        region = auto_detect_speed_region(cap, ocr_engine)
        if region is None:
            sys.exit(
                "错误：未能自动检测到速度文字，请用 --ocr-region 手动指定区域。\n"
                "提示：先截取视频第一帧，找到速度数字的像素位置，\n"
                "      格式为 'x1,y1,x2,y2'，例如 --ocr-region \"0,720,640,800\""
            )
        x1, y1, x2, y2 = region
        print(f"OCR 区域（自动）：x=[{x1},{x2}]  y=[{y1},{y2}]")

    print(f"视频信息：{total_frames} 帧，{fps:.1f} fps，播放倍速 {args.playback_speed}x")
    print(f"参数：每 {args.distance} 米抽一帧，每 {args.ocr_interval} 帧 OCR 一次")
    print("-" * 50)

    # --- 状态变量 ---
    cumulative_distance_m = 0.0   # 已行驶的累计距离（米）
    next_extract_at_m = 0.0       # 下一次应抽帧时的累计距离阈值
    current_speed_ms = None       # 当前使用的速度（m/s），None 表示尚未读到有效速度
    extracted_count = 0           # 已抽出的帧数量
    csv_rows = []                 # 记录每张抽帧的元数据

    frame_index = 0

    while True:
        if frame_index >= max_frames:
            break
        ret, frame = cap.read()
        if not ret:
            break

        # --- OCR：每隔 ocr_interval 帧识别一次速度 ---
        if frame_index % args.ocr_interval == 0:
            crop = frame[y1:y2, x1:x2]
            try:
                ocr_result = ocr_engine.ocr(crop)
                speed, unit = extract_speed_kmh(ocr_result)
                if speed is not None:
                    current_speed_ms = speed / 3.6 if unit == "kmh" else speed * 0.44704
                # speed 为 None 时：保持 current_speed_ms 不变（前向填充）
            except Exception as exc:
                print(f"警告：第 {frame_index} 帧 OCR 异常，使用上一帧速度。原因：{exc}")

        # --- 距离积分：speed(m/s) × time(s) = distance(m)，未读到速度前不积分 ---
        if current_speed_ms is not None:
            cumulative_distance_m += current_speed_ms * seconds_per_frame

        # --- 判断是否达到抽帧阈值 ---
        if cumulative_distance_m >= next_extract_at_m:
            extracted_count += 1
            timestamp_s = frame_index / fps

            filename = f"frame_{extracted_count:04d}_dist_{int(next_extract_at_m)}m.jpg"
            output_path = os.path.join(output_dir, filename)
            cv2.imwrite(output_path, frame)

            csv_rows.append({
                "frame_index": frame_index,
                "timestamp_s": f"{timestamp_s:.3f}",
                "speed_kmh": f"{current_speed_ms * 3.6:.1f}" if current_speed_ms is not None else "0.0",
                "cumulative_distance_m": f"{cumulative_distance_m:.2f}",
            })

            next_extract_at_m += args.distance

        # --- 进度打印 ---
        if frame_index % 100 == 0:
            progress_pct = frame_index / total_frames * 100
            print(
                f"进度：{frame_index}/{total_frames} ({progress_pct:.1f}%)  "
                f"速度={current_speed_ms * 3.6:.0f} km/h  " if current_speed_ms is not None else "速度=-- km/h  "
                f"累计={cumulative_distance_m:.1f} m  "
                f"已抽={extracted_count} 帧"
            )

        frame_index += 1

    cap.release()

    # --- 写 CSV ---
    csv_path = os.path.join(output_dir, "extracted_frames.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = ["frame_index", "timestamp_s", "speed_kmh", "cumulative_distance_m"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(csv_rows)

    print("-" * 50)
    print(f"完成。共抽出 {extracted_count} 帧，保存在 {output_dir}/")
    print(f"CSV 记录已写入 {csv_path}")


if __name__ == "__main__":
    main()
