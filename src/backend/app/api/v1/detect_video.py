"""
detect_video.py
/api/v1/detect-video 路由

Endpoints:
  POST /api/v1/detect-video/first-frame  — 返回视频第一帧，供前端画框选区域
  POST /api/v1/detect-video              — 主推理接口（ocr / timed 两种模式）
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord
from app.services.video_service import (
    detect_video_ocr,
    detect_video_timed,
    get_first_frame,
)

router = APIRouter(prefix="/api/v1", tags=["detect-video"])

MAX_VIDEO_MB = 500


@router.post("/detect-video/first-frame")
async def first_frame(file: UploadFile = File(...)):
    """
    读取视频第一帧，返回 base64 data URI 及原始分辨率。
    供前端在画布上手动框选速度区域使用。

    Response: {"frame_b64": "data:image/jpeg;base64,...", "width": W, "height": H}
    """
    video_bytes = await file.read()
    try:
        data = get_first_frame(video_bytes)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    return JSONResponse(content=data)


@router.post("/detect-video")
async def detect_video(
    file: UploadFile = File(...),
    mode: str = Form(..., description="'ocr' 或 'timed'"),
    interval_meters: float = Form(5.0, description="每隔多少米截一帧"),
    ocr_region: Optional[str] = Form(
        None, description="手动速度区域 'x1,y1,x2,y2'（仅 ocr 模式使用）"
    ),
    approx_speed_kmh: Optional[float] = Form(
        None, description="大致车速 km/h（仅 timed 模式使用）"
    ),
    db: Session = Depends(get_db),
):
    """
    视频推理主接口。

    mode=ocr   : 读取视频内速度字幕，按行驶距离抽帧推理
    mode=timed : 按估算车速 + 间隔米数计算截帧频率推理

    Response:
    {
      "status":       "ok" | "ocr_failed",
      "total_frames": int,
      "results": [
        { "filename", "detections", "image_b64", "inference_ms", "location", "timestamp" },
        ...
      ]
    }
    """
    if mode not in ("ocr", "timed"):
        raise HTTPException(400, detail="mode 必须为 'ocr' 或 'timed'")
    if mode == "timed" and approx_speed_kmh is None:
        raise HTTPException(400, detail="timed 模式必须提供 approx_speed_kmh")
    if interval_meters <= 0:
        raise HTTPException(400, detail="interval_meters 必须大于 0")

    video_bytes = await file.read()
    if len(video_bytes) / 1024 / 1024 > MAX_VIDEO_MB:
        raise HTTPException(413, detail=f"视频文件超过 {MAX_VIDEO_MB} MB 限制")

    # 解析手动框选的速度区域坐标
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

    try:
        if mode == "ocr":
            result = detect_video_ocr(
                video_bytes,
                interval_meters=interval_meters,
                ocr_region=parsed_region,
            )
        else:
            frames = detect_video_timed(
                video_bytes,
                approx_speed_kmh=approx_speed_kmh,
                interval_meters=interval_meters,
            )
            result = {
                "status":       "ok",
                "results":      frames,
                "total_frames": len(frames),
            }

    except FileNotFoundError:
        raise HTTPException(
            503, detail="模型权重尚未就绪（best.pt 不存在），请等待训练完成后再试"
        )
    except ValueError as e:
        raise HTTPException(422, detail=str(e))

    # ==========================================
    # 将视频各帧检测结果持久化到 PostgreSQL
    # ==========================================
    frame_results = result.get("results", [])
    for frame in frame_results:
        location = frame.get("location") or {}
        lat = location.get("lat", 0.0)
        lng = location.get("lng", 0.0)

        raw_ts = frame.get("timestamp")
        try:
            ts = datetime.fromisoformat(raw_ts) if raw_ts else datetime.utcnow()
        except (ValueError, TypeError):
            ts = datetime.utcnow()

        for det in frame.get("detections", []):
            db_record = DiseaseRecord(
                filename=frame.get("filename"),
                lat=lat,
                lng=lng,
                timestamp=ts,
                label=det.get("label"),
                label_cn=det.get("label_cn"),
                confidence=det.get("conf"),
                color_hex=det.get("color"),
                bbox=det.get("bbox"),
            )
            db.add(db_record)

    db.commit()

    return JSONResponse(content=result)
