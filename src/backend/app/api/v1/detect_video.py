"""
detect_video.py  —  /api/v1/detect-video 路由（非阻塞版）

提交任务模型：
  POST /api/v1/detect-video/first-frame  — 返回第一帧（同步 def，线程池执行）
  POST /api/v1/detect-video              — 提交任务，立即返回 task_id
  GET  /api/v1/detect-video/status/{id} — 轮询任务进度与结果
"""

import json as _json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.api.deps import get_current_user
from app.db.database import SessionLocal
from app.db.models import DiseaseRecord, User
from app.services.clustering_service import assign_cluster
from app.services.video_service import (
    detect_video_gps,
    detect_video_ocr,
    detect_video_timed,
    get_first_frame,
)

router = APIRouter(prefix="/api/v1", tags=["detect-video"])

MAX_VIDEO_MB = 500

# ── 任务状态存储（单进程内存，重启后清空）────────────────────────────────
# key  : task_id (UUID str)
# value: {"status": "queued|processing|done|failed", "result": {...}, "error": "..."}
_tasks: dict[str, dict] = {}

# 限制并发视频任务数，防止同时多路推理耗尽显存
_video_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="video_worker")


# ── 后台工作函数 ──────────────────────────────────────────────────────────

def _run_video_task(
    task_id: str,
    mode: str,
    video_bytes: bytes,
    interval_meters: float,
    parsed_region: Optional[tuple],
    approx_speed_kmh: Optional[float],
    gps_track_json: Optional[str],
    creator_id: int,
    source_type: str,
    device_id: Optional[str],
) -> None:
    """
    在独立线程中执行完整的视频推理流程并持久化结果。
    所有异常均在此捕获，不向主进程传播，通过 _tasks 记录状态。
    """
    _tasks[task_id]["status"] = "processing"
    try:
        if mode == "ocr":
            result = detect_video_ocr(
                video_bytes,
                interval_meters=interval_meters,
                ocr_region=parsed_region,
            )
        elif mode == "timed":
            frames = detect_video_timed(
                video_bytes,
                approx_speed_kmh=approx_speed_kmh,
                interval_meters=interval_meters,
            )
            result = {"status": "ok", "results": frames, "total_frames": len(frames)}
        else:  # gps
            track = _json.loads(gps_track_json)
            frames = detect_video_gps(
                video_bytes,
                gps_track=track,
                interval_meters=interval_meters,
            )
            result = {"status": "ok", "results": frames, "total_frames": len(frames)}

        # ── 持久化（独立 Session，与 HTTP 请求生命周期解耦）────────────
        db = SessionLocal()
        try:
            for frame in result.get("results", []):
                location = frame.get("location") or {}
                lat = location.get("lat", 0.0)
                lng = location.get("lng", 0.0)
                raw_ts = frame.get("timestamp")
                try:
                    ts = datetime.fromisoformat(raw_ts) if raw_ts else datetime.utcnow()
                except (ValueError, TypeError):
                    ts = datetime.utcnow()

                for det in frame.get("detections", []):
                    feature = det.get("feature")
                    cluster_id = assign_cluster(lat, lng, det.get("label_cn"), feature, db)
                    db.add(DiseaseRecord(
                        filename=frame.get("filename"),
                        lat=lat,
                        lng=lng,
                        timestamp=ts,
                        label=det.get("label"),
                        label_cn=det.get("label_cn"),
                        confidence=det.get("conf"),
                        color_hex=det.get("color"),
                        bbox=det.get("bbox"),
                        feature_vector=feature,
                        cluster_id=cluster_id,
                        source_type=source_type,
                        device_id=device_id,
                        creator_id=creator_id,
                    ))
            db.commit()
        finally:
            db.close()

        _tasks[task_id] = {"status": "done", "result": result}

    except Exception as exc:
        _tasks[task_id] = {"status": "failed", "error": str(exc)}


# ── 路由 ──────────────────────────────────────────────────────────────────

@router.post("/detect-video/first-frame")
def first_frame(file: UploadFile = File(...)):
    """
    读取视频第一帧，返回 base64 data URI 及原始分辨率。
    sync def：FastAPI 自动放入线程池，不阻塞事件循环。
    """
    video_bytes = file.file.read()
    try:
        data = get_first_frame(video_bytes)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    return JSONResponse(content=data)


@router.post("/detect-video")
async def detect_video(
    file: UploadFile = File(...),
    mode: str = Form(..., description="'ocr' | 'timed' | 'gps'"),
    interval_meters: float = Form(5.0, description="每隔多少米截一帧"),
    ocr_region: Optional[str] = Form(
        None, description="手动速度区域 'x1,y1,x2,y2'（仅 ocr 模式使用）"
    ),
    approx_speed_kmh: Optional[float] = Form(
        None, description="大致车速 km/h（仅 timed 模式使用）"
    ),
    gps_track: Optional[str] = Form(
        None, description="GPS 轨迹 JSON 字符串（仅 gps 模式使用）"
    ),
    current_user: User = Depends(get_current_user),
):
    """
    提交视频推理任务，**立即**返回 task_id。

    前端轮询 GET /api/v1/detect-video/status/{task_id} 获取进度，
    status 取值：queued → processing → done | failed。

    Response: {"task_id": "...", "status": "queued"}
    """
    if mode not in ("ocr", "timed", "gps"):
        raise HTTPException(400, detail="mode 必须为 'ocr'、'timed' 或 'gps'")
    if mode == "timed" and approx_speed_kmh is None:
        raise HTTPException(400, detail="timed 模式必须提供 approx_speed_kmh")
    if mode == "gps" and not gps_track:
        raise HTTPException(400, detail="gps 模式必须提供 gps_track")
    if interval_meters <= 0:
        raise HTTPException(400, detail="interval_meters 必须大于 0")

    video_bytes = await file.read()
    if len(video_bytes) / 1024 / 1024 > MAX_VIDEO_MB:
        raise HTTPException(413, detail=f"视频文件超过 {MAX_VIDEO_MB} MB 限制")

    parsed_region = None
    if ocr_region:
        try:
            parts = [int(v.strip()) for v in ocr_region.split(",")]
            if len(parts) != 4:
                raise ValueError("需要恰好 4 个整数")
            parsed_region = tuple(parts)
        except ValueError:
            raise HTTPException(
                400, detail="ocr_region 格式错误，应为 'x1,y1,x2,y2'，例如 '0,720,200,800'"
            )

    task_id = str(uuid.uuid4())
    _tasks[task_id] = {"status": "queued"}

    _video_executor.submit(
        _run_video_task,
        task_id,
        mode,
        video_bytes,
        interval_meters,
        parsed_region,
        approx_speed_kmh,
        gps_track,
        current_user.id,
        current_user.source_type or "manual",
        current_user.device_id,
    )

    return JSONResponse({"task_id": task_id, "status": "queued"})


@router.get("/detect-video/status/{task_id}")
async def detect_video_status(
    task_id: str,
    _: User = Depends(get_current_user),
):
    """
    轮询视频推理任务状态。

    Response:
      {"status": "queued"}
      {"status": "processing"}
      {"status": "done",   "result": { "status", "total_frames", "results": [...] }}
      {"status": "failed", "error": "..."}
    """
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(404, detail="任务不存在或已过期")
    return JSONResponse(task)
