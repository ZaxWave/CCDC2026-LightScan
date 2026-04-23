"""
video_service.py
视频推理服务

两种抽帧模式：
  ocr   — 读取视频内速度叠加字幕，按行驶距离均匀抽帧（依赖 PaddleOCR）
  timed — 根据大致车速和目标间隔米数计算截帧间隔，不依赖 OCR
"""

import base64
import bisect
import math
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

import cv2
import numpy as np

from app.services.inference_service import run_detect

# ── OCR 引擎单例 ───────────────────────────────────────────────────────────
_ocr_engine = None  # 单例：只加载一次
_ocr_lock = None  # 线程锁

def _get_ocr_engine():
    """获取 OCR 单例，仅第一次调用时加载模型。"""
    global _ocr_engine, _ocr_lock
    if _ocr_engine is not None:
        return _ocr_engine
    
    try:
        import threading
        _ocr_lock = threading.Lock()
        
        from paddleocr import PaddleOCR
        
        # 使用移动版模型（精度好 + 速度快 + 内存省）
        _ocr_engine = PaddleOCR(
            use_angle_cls=False,
            lang='en',
            enable_mkldnn=False,  # 禁用 OneDNN，避免 ConvertPirAttribute 不兼容异常
        )
        return _ocr_engine
    except Exception as e:
        print(f"[OCR] 加载失败: {e}")
        raise


# ── 常量 ───────────────────────────────────────────────────────────────────
OCR_INTERVAL = 90    # 每 N 帧做一次 OCR（30fps 下约 3 秒，减少 OCR 调用次数）
OCR_PROBES   = 3     # 自动检测速度区域时的采样帧数（减少采样）
REGION_PAD   = 20    # 自动检测区域时向外扩展的像素边距
MAX_FRAMES   = 200   # 单次最多推理帧数（进一步限制，防止内存溢出）


# ── 视频 I/O ──────────────────────────────────────────────────────────────

@contextmanager
def _open_video(video_bytes: bytes) -> Generator[cv2.VideoCapture, None, None]:
    """将视频字节写入临时文件，打开 VideoCapture，退出时自动清理。"""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = Path(tmp.name)

    cap = cv2.VideoCapture(str(tmp_path))
    try:
        if not cap.isOpened():
            raise ValueError("无法打开视频文件，请检查格式是否为 MP4")
        yield cap
    finally:
        cap.release()
        tmp_path.unlink(missing_ok=True)


def _frame_to_bytes(frame: np.ndarray) -> bytes:
    """将 cv2 BGR 帧编码为 JPEG 字节。"""
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


def get_first_frame(video_bytes: bytes) -> dict:
    """
    读取视频第一帧，返回 base64 data URI 及原始分辨率。
    供前端在画布上手动框选速度区域使用。

    Returns: {"frame_b64": "data:image/jpeg;base64,...", "width": W, "height": H}
    """
    with _open_video(video_bytes) as cap:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        ret, frame = cap.read()
        if not ret:
            raise ValueError("视频为空或第一帧读取失败")
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
        b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode()

    return {"frame_b64": b64, "width": w, "height": h}


# ── OCR 工具 ──────────────────────────────────────────────────────────────

def _iter_ocr_items(result):
    """
    统一解析 PaddleOCR 结果，yield (text, score, poly)。
    兼容 PaddleOCR 2.x（list 格式）和 3.x（dict 格式）。
    """
    for page in (result or []):
        if isinstance(page, dict):
            for text, score, poly in zip(
                page.get("rec_texts", []),
                page.get("rec_scores", []),
                page.get("rec_polys", []),
            ):
                yield text, score, poly
        elif isinstance(page, list):
            for item in page:
                try:
                    box, (text, score) = item
                    yield text, score, np.array(box, dtype=np.float32)
                except Exception:
                    continue


def _extract_speed_kmh(ocr_result) -> float | None:
    """
    从 OCR 结果中提取速度值（统一换算为 km/h）。
    识别优先级：
      1. 带单位：KM/H、KMH、KPH、MPH 等变体
      2. 无单位：独立的 2-3 位整数（20-200 范围），兜底行车仪只显示数字的情形
    失败返回 None。
    """
    items = list(_iter_ocr_items(ocr_result))
    if not items:
        return None

    texts = [t for t, s, _ in items if s > 0.3]
    full_text = " ".join(texts)

    # ── 带单位匹配（高置信度）──────────────────────────────────
    m = re.search(r"(\d{1,3})\s*[KX]M[/.]?[HP]?H?", full_text, re.IGNORECASE)
    if m:
        v = float(m.group(1))
        if 5 <= v <= 250:
            return v

    m = re.search(r"(\d{1,3})\s*MPH", full_text, re.IGNORECASE)
    if m:
        v = float(m.group(1))
        if 5 <= v <= 160:
            return v * 1.60934

    # ── 无单位兜底（置信度 > 0.5，避免噪声）──────────────────────
    # 只从每个文本块中查找独立整数，避免拼接后的误匹配
    for text, score, _ in items:
        if score < 0.5:
            continue
        m = re.fullmatch(r"\s*(\d{2,3})\s*", text)
        if m:
            v = float(m.group(1))
            if 10 <= v <= 200:
                return v

    return None


def _auto_detect_speed_region(
    cap: cv2.VideoCapture,
    ocr_engine,
) -> tuple[int, int, int, int] | None:
    """
    采样 2 个探针帧，各对底部 40% 区域做 OCR，寻找速度字幕位置。
    速度叠加层几乎总在画面底部，聚焦底部可提高识别率且只需 2 次 OCR 调用。
    返回 (x1, y1, x2, y2)，找不到返回 None。
    """
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fw    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # 底部 40% 的 y 起点
    bottom_y = int(fh * 0.6)

    probe_indices = [int(total * 0.25), int(total * 0.75)]
    boxes = []

    for idx in probe_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            continue
        crop = frame[bottom_y:, :]  # 只取底部 40%
        try:
            res = ocr_engine.ocr(crop)
        except Exception as e:
            print(f"[OCR auto-detect] OCR调用异常: {e}", flush=True)
            continue
        print(f"[OCR auto-detect] 帧{idx} 原始结果类型={type(res)} len={len(res) if res else 0} raw={repr(res)[:300]}", flush=True)
        for text, score, poly in _iter_ocr_items(res):
            print(f"[OCR auto-detect] score={score:.2f} text={repr(text)}", flush=True)
            if score > 0.3 and re.search(r"\d+\s*[KX]M.?H", text, re.IGNORECASE):
                pts = np.array(poly, dtype=np.float32).reshape(-1, 2)
                boxes.append((
                    int(pts[:, 0].min()),
                    bottom_y + int(pts[:, 1].min()),
                    int(pts[:, 0].max()),
                    bottom_y + int(pts[:, 1].max()),
                ))

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    if not boxes:
        return None

    return (
        max(0,  min(b[0] for b in boxes) - REGION_PAD),
        max(0,  min(b[1] for b in boxes) - REGION_PAD),
        min(fw, max(b[2] for b in boxes) + REGION_PAD),
        min(fh, max(b[3] for b in boxes) + REGION_PAD),
    )


# ── 主要对外接口 ──────────────────────────────────────────────────────────

def detect_video_ocr(
    video_bytes: bytes,
    interval_meters: float = 5.0,
    ocr_region: tuple[int, int, int, int] | None = None,
    progress_cb=None,
    phase_cb=None,
) -> dict:
    """
    OCR 距离模式：识别视频内速度字幕，按行驶距离均匀抽帧，逐帧推理。

    Parameters
    ----------
    video_bytes     : 视频文件的原始字节
    interval_meters : 每隔多少米抽一帧
    ocr_region      : 手动指定的速度区域 (x1,y1,x2,y2)；None 则自动检测

    Returns
    -------
    {"status": "ok",         "results": [...], "total_frames": N}
    {"status": "ocr_failed", "results": [],    "total_frames": 0}
    """
    # 获取 OCR 单例（首次调用会加载模型，可能耗时数分钟）
    if phase_cb:
        phase_cb("ocr_loading")
    ocr_engine = _get_ocr_engine()
    if phase_cb:
        phase_cb("ocr_detecting")

    with _open_video(video_bytes) as cap:
        fps            = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames   = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        secs_per_frame = 1.0 / fps

        # 确定速度区域（自动检测或手动指定）
        print(f"[OCR] 收到 ocr_region={ocr_region} total_frames={total_frames} fps={fps:.1f}", flush=True)
        if ocr_region is None:
            ocr_region = _auto_detect_speed_region(cap, ocr_engine)
            if ocr_region is None:
                return {"status": "ocr_failed", "results": [], "total_frames": 0}

        rx1, ry1, rx2, ry2 = ocr_region
        results         = []
        cumul_m         = 0.0
        next_extract_m  = 0.0
        speed_ms: float | None = None
        frame_idx       = 0
        last_ocr_idx    = -OCR_INTERVAL  # 强制第一帧做 OCR
        # 扫描超过 10% 仍未找到速度则认为无速度字幕
        speed_search_limit = max(int(total_frames * 0.1), OCR_INTERVAL * 3)

        while len(results) < MAX_FRAMES and frame_idx < total_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

            # ── OCR 识速（每 OCR_INTERVAL 帧一次）─────────────────
            if frame_idx - last_ocr_idx >= OCR_INTERVAL:
                crop = frame[ry1:ry2, rx1:rx2]
                try:
                    ocr_res = ocr_engine.ocr(crop)
                    kmh     = _extract_speed_kmh(ocr_res)
                    items   = list(_iter_ocr_items(ocr_res))
                    print(f"[OCR loop] frame={frame_idx} crop={crop.shape} texts={[t for t,s,_ in items if s>0.3]} kmh={kmh}", flush=True)
                    if kmh is not None:
                        speed_ms = kmh / 3.6
                except Exception as e:
                    print(f"[OCR loop] frame={frame_idx} 异常: {e}", flush=True)
                last_ocr_idx = frame_idx

            if speed_ms is None:
                if frame_idx >= speed_search_limit:
                    # 扫描了足够多帧仍未识别到速度，放弃
                    print(f"[video_service] OCR 未在前 {speed_search_limit} 帧内找到速度，返回 ocr_failed")
                    return {"status": "ocr_failed", "results": [], "total_frames": 0}
                frame_idx += 1
                continue

            # ── 计算到这一帧时的累计里程 ──────────────────────────
            # 从上次 OCR 帧到当前帧视为匀速行驶
            cumul_m += speed_ms * secs_per_frame

            # ── 达到抽帧阈值：推理 ────────────────────────────────
            if cumul_m >= next_extract_m:
                extracted_n = len(results) + 1
                frame_name  = f"frame_{extracted_n:04d}_{int(next_extract_m)}m.jpg"
                try:
                    res = run_detect(_frame_to_bytes(frame))
                except Exception as e:
                    print(f"[video_service] ocr frame {len(results)+1} 推理失败，跳过: {e}")
                    next_extract_m += interval_meters
                    continue
                res["filename"] = frame_name
                results.append(res)
                if progress_cb:
                    progress_cb(len(results))
                next_extract_m += interval_meters

                # ── 跳帧优化：直接跳到下一个预期抽帧位置 ─────────────
                # 下一抽帧距离所需秒数 / 帧时 = 需要跳过的帧数
                frames_to_skip = max(1, int(interval_meters / speed_ms / secs_per_frame) - OCR_INTERVAL)
                frame_idx += frames_to_skip
            else:
                frame_idx += 1

    return {"status": "ok", "results": results, "total_frames": len(results)}


# ── GPS 轨迹工具函数 ───────────────────────────────────────────────────────

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine 公式计算两个 GPS 点之间的距离（米）。"""
    R = 6_371_000.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lng2 - lng1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _interp_value(t: float, times: list[float], values: list[float]) -> float:
    """在有序时间序列上对单个数值列做线性插值。"""
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    i = bisect.bisect_right(times, t) - 1
    ratio = (t - times[i]) / (times[i + 1] - times[i])
    return values[i] + ratio * (values[i + 1] - values[i])


def detect_video_gps(
    video_bytes: bytes,
    gps_track: list[dict],
    interval_meters: float = 5.0,
    progress_cb=None,
) -> list[dict]:
    """
    GPS 轨迹导引抽帧模式。

    录制时移动端每秒记录一个 GPS 点，构成轨迹。本函数根据轨迹计算
    累计行驶距离，每隔 interval_meters 提取一帧推理，并将插值得到的
    真实经纬度写入结果，替代 EXIF 或模拟坐标。

    Parameters
    ----------
    video_bytes     : 视频原始字节
    gps_track       : [{lat, lng, timestamp_ms, speed_kmh}, ...] 移动端上传的轨迹
    interval_meters : 每隔多少米抽一帧（默认 5m）

    Returns
    -------
    list of frame result dicts，每项含 location: {lat, lng} 真实坐标
    """
    if len(gps_track) < 2:
        raise ValueError("GPS 轨迹至少需要 2 个点")

    # 按时间戳排序
    track = sorted(gps_track, key=lambda p: p["timestamp_ms"])
    t0_ms = track[0]["timestamp_ms"]                        # 录制开始的绝对时间（ms）

    # 构建累计距离数组和相对时间数组（秒）
    track_times_s: list[float] = [0.0]
    cumul_dists:   list[float] = [0.0]
    for i in range(1, len(track)):
        dt_s = (track[i]["timestamp_ms"] - track[i - 1]["timestamp_ms"]) / 1000.0
        d_m  = _haversine_m(
            track[i - 1]["lat"], track[i - 1]["lng"],
            track[i]["lat"],     track[i]["lng"],
        )
        track_times_s.append(track_times_s[-1] + max(dt_s, 0.0))
        cumul_dists.append(cumul_dists[-1] + d_m)

    lats   = [p["lat"] for p in track]
    lngs   = [p["lng"] for p in track]
    speeds = [max(p.get("speed_kmh", 30.0), 1.0) for p in track]   # 至少 1 km/h 防除零

    results: list[dict] = []

    with _open_video(video_bytes) as cap:
        fps          = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        max_video_s  = total_frames / fps
        max_gps_s    = track_times_s[-1]
        cover_s      = min(max_video_s, max_gps_s)   # 以较短者为准

        next_dist_m = 0.0
        frame_idx   = 0

        while frame_idx < total_frames and len(results) < MAX_FRAMES:
            frame_time_s = frame_idx / fps
            if frame_time_s > cover_s:
                break

            curr_dist_m = _interp_value(frame_time_s, track_times_s, cumul_dists)

            if curr_dist_m >= next_dist_m:
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
                ret, frame = cap.read()
                if not ret:
                    break

                # 插值真实经纬度
                interp_lat = _interp_value(frame_time_s, track_times_s, lats)
                interp_lng = _interp_value(frame_time_s, track_times_s, lngs)

                extracted_n = len(results) + 1
                frame_name  = f"gps_frame_{extracted_n:04d}_{int(curr_dist_m)}m.jpg"

                try:
                    res = run_detect(_frame_to_bytes(frame))
                except Exception as e:
                    print(f"[video_service] gps frame {len(results)+1} 推理失败，跳过: {e}")
                    next_dist_m += interval_meters
                    continue
                res["filename"] = frame_name
                res["location"] = {"lat": interp_lat, "lng": interp_lng}
                results.append(res)
                if progress_cb:
                    progress_cb(len(results))

                next_dist_m += interval_meters

                # 跳帧：利用当前速度预估下一抽帧位置
                speed_kmh    = _interp_value(frame_time_s, track_times_s, speeds)
                speed_ms     = speed_kmh / 3.6
                frames_ahead = max(1, int(interval_meters / speed_ms * fps * 0.85))
                frame_idx   += frames_ahead
            else:
                frame_idx += 1

    return results


def detect_video_timed(
    video_bytes: bytes,
    approx_speed_kmh: float,
    interval_meters: float,
    progress_cb=None,
) -> list[dict]:
    """
    时间估算模式：根据大致车速和目标间隔米数计算截帧频率，直接跳帧推理。

    使用 cap.set(CAP_PROP_POS_FRAMES) 直接定位目标帧，避免逐帧读取，
    速度比顺序读帧快 10-50 倍。

    Parameters
    ----------
    video_bytes      : 视频文件的原始字节
    approx_speed_kmh : 大致车速（km/h）
    interval_meters  : 期望的抽帧间隔（米）
    """
    results = []

    with _open_video(video_bytes) as cap:
        fps            = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames   = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        speed_ms       = approx_speed_kmh / 3.6
        # interval_meters / speed_ms = 间隔秒数；× fps = 帧间隔
        frame_interval = max(1, int(round(interval_meters / speed_ms * fps)))

        target_idx  = 0
        extracted_n = 0

        while target_idx < total_frames and extracted_n < MAX_FRAMES:
            # 直接跳到目标帧，避免读取所有中间帧
            cap.set(cv2.CAP_PROP_POS_FRAMES, target_idx)
            ret, frame = cap.read()
            if not ret:
                break

            extracted_n += 1
            est_dist_m   = int(target_idx / fps * speed_ms)
            frame_name   = f"frame_{extracted_n:04d}_{est_dist_m}m.jpg"
            try:
                res = run_detect(_frame_to_bytes(frame))
            except Exception as e:
                print(f"[video_service] timed frame {extracted_n} 推理失败，跳过: {e}")
                target_idx += frame_interval
                continue
            res["filename"] = frame_name
            results.append(res)
            if progress_cb:
                progress_cb(extracted_n)

            target_idx += frame_interval

    return results
