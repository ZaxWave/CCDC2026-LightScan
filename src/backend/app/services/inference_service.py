import asyncio
import sys
import threading
import time
import base64
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[4]  # -> CCDC2026-LightScan/
sys.path.insert(0, str(ROOT))

from inference import LightScanInference
from .geo_service import extract_gps_from_image
from datetime import datetime, timezone

# 串行化推理：防止多线程并发导致显存溢出
_inference_lock = threading.Semaphore(1)
# 专用单线程执行器，供 async 路由通过 run_in_executor 调用
_inference_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="lsdet_worker")

# RDD2022 类别中文映射字典
LABEL_CN = {
    "D00": "纵向裂缝",
    "D10": "横向裂缝",
    "D20": "龟裂",
    "D40": "坑槽",
}

# --- 统一颜色配置字典 (RGB 颜色空间) ---
# 颜色语义映射标准：黄 (轻度注意) -> 橙 (中度警告) -> 亮红 (高危) -> 品红 (结构性破坏)
COLOR_CONFIG = {
    "D00": {"name": "纵向裂缝", "rgb": (255, 204, 0),   "hex": "#FFCC00"}, 
    "D10": {"name": "横向裂缝", "rgb": (255, 136, 0),   "hex": "#FF8800"}, 
    "D40": {"name": "坑槽",     "rgb": (255, 68, 68),   "hex": "#FF4444"}, 
    "D20": {"name": "龟裂",     "rgb": (255, 20, 147),  "hex": "#FF1493"}, 
}

# 生成后端 OpenCV 绘图所需的 BGR 颜色映射
LABEL_COLORS = {k: (v["rgb"][2], v["rgb"][1], v["rgb"][0]) for k, v in COLOR_CONFIG.items()}

# 生成前端渲染所需的 HEX 颜色映射
LABEL_HEX = {k: v["hex"] for k, v in COLOR_CONFIG.items()}

DEFAULT_COLOR_BGR = (255, 255, 255)
DEFAULT_HEX = "#FFFFFF"


def extract_feature(img_bgr: np.ndarray, bbox: list) -> list:
    """
    从检测框裁剪区域提取轻量视觉特征向量（32 维 HSV 颜色直方图）。

    用于 ReID 空间聚类：当两条记录 GPS 距离相近时，进一步比较
    检测区域的颜色分布相似度，判断是否为同一病害点的重复拍摄。

    Returns: 归一化后的 float 列表，空裁剪时返回空列表。
    """
    x1, y1, x2, y2 = [max(0, int(v)) for v in bbox]
    crop = img_bgr[y1:y2, x1:x2]
    if crop.size == 0:
        return []
    hsv    = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hist_h = cv2.calcHist([hsv], [0], None, [16], [0, 180]).flatten()  # 色调 16 档
    hist_s = cv2.calcHist([hsv], [1], None, [8],  [0, 256]).flatten()  # 饱和度 8 档
    hist_v = cv2.calcHist([hsv], [2], None, [8],  [0, 256]).flatten()  # 明度 8 档
    feat   = np.concatenate([hist_h, hist_s, hist_v])                  # 32 维
    norm   = np.linalg.norm(feat)
    return (feat / norm).tolist() if norm > 1e-6 else feat.tolist()

# 类别样式标签映射 (保留兼容性)
LABEL_TAG = {
    "D00": "tag-crack",
    "D10": "tag-crack",
    "D20": "tag-crack",
    "D40": "tag-pothole",
}

_engine: LightScanInference | None = None


def get_engine() -> LightScanInference:
    """懒加载模型实例，避免重复初始化开销。"""
    global _engine
    if _engine is None:
        _engine = LightScanInference()
    return _engine


def preload_model() -> None:
    """由 lifespan 在启动时调用，提前预热模型，消除首次请求延迟。"""
    get_engine()


async def run_detect_async(img_bytes: bytes, conf: float = 0.25) -> dict:
    """异步包装：将阻塞推理卸载到专用单线程执行器，不阻塞事件循环。"""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _inference_executor, partial(run_detect, img_bytes, conf=conf)
    )


def run_detect(img_bytes: bytes, conf: float = 0.25) -> dict:
    """
    处理单张图像的推理请求。
    
    包含图像解码、格式转换、调用 SAHI 推理引擎、
    结构化结果解析及目标框的可视化绘制。
    通过全局信号量保证 GPU 串行执行，防止多线程并发导致显存溢出。
    """
    with _inference_lock:
        return _run_detect_impl(img_bytes, conf)


def _run_detect_impl(img_bytes: bytes, conf: float = 0.25) -> dict:
    """实际推理逻辑，由 run_detect 持有锁后调用。"""
    engine = get_engine()

    lat, lng = extract_gps_from_image(img_bytes)
    current_time = datetime.now(tz=timezone.utc).isoformat()

    # 图像解码为 numpy 数组，默认 BGR 通道顺序
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("图像解码失败，请校验输入数据格式")

    # SAHI 引擎要求输入 RGB 格式
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    t0 = time.perf_counter()
    # 执行模型推理
    result = engine.run(img_rgb, conf=conf)
    inference_ms = round((time.perf_counter() - t0) * 1000, 1)

    # ---------------- 推理结果解析与可视化构建 ----------------
    detections = []
    
    # 遍历 SAHI 返回的预测对象列表
    for obj in result.object_prediction_list:
        label = obj.category.name
        confidence = round(obj.score.value, 3)
        
        # 提取目标边界框像素坐标
        x1 = int(obj.bbox.minx)
        y1 = int(obj.bbox.miny)
        x2 = int(obj.bbox.maxx)
        y2 = int(obj.bbox.maxy)
        
        label_cn = LABEL_CN.get(label, label)
        
        # 提取 ReID 特征向量（HSV 直方图，用于后续空间聚类去重）
        feature = extract_feature(img_bgr, [x1, y1, x2, y2])

        # 封装前端所需数据结构
        detections.append({
            "label":       label,
            "label_cn":    label_cn,
            "color":       LABEL_HEX.get(label, DEFAULT_HEX),
            "conf":        confidence,       # 兼容旧代码
            "confidence":  confidence,       # 新代码标准
            "bbox":        [x1, y1, x2, y2],
            "feature":     feature,          # 传递给 API 层做聚类，不发往前
        })

        # --- 图像可视化绘制 ---
        box_color = LABEL_COLORS.get(label, DEFAULT_COLOR_BGR)
        
        # 绘制目标边界框
        cv2.rectangle(img_bgr, (x1, y1), (x2, y2), box_color, 2)
        
        # 绘制标签文字及其背景衬底
        text = f"{label} {confidence:.2f}"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(img_bgr, (x1, max(0, y1 - 20)), (x1 + tw, y1), box_color, -1)
        cv2.putText(img_bgr, text, (x1, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

    # 将绘制完毕的 BGR 图像直接编码为 JPEG base64 字符串
    _, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 88])
    image_b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode()

    return {
        "detections":   detections,
        "image_b64":    image_b64,
        "inference_ms": inference_ms,
        "location": {"lat": lat, "lng": lng}, 
        "timestamp": current_time             
    }