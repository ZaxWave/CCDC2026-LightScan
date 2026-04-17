from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.services.inference_service import run_detect
from app.services.clustering_service import assign_cluster
from app.db.database import get_db
from app.db.models import DiseaseRecord, User
from app.api.deps import get_current_user # 引入路由守卫

router = APIRouter(prefix="/api/v1", tags=["detect"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}
MAX_FILES = 20

@router.post("/detect")
async def detect(
    files: list[UploadFile] = File(...),
    conf: float = Query(0.25, ge=0.0, le=1.0, description="置信度阈值"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # 强制要求用户登录并获取身份
):
    """
    接收 1–20 张图片，返回每张的检测结果与标注图，并将时空病害数据写入 PostgreSQL 数据库。
    """
    if len(files) > MAX_FILES:
        raise HTTPException(400, detail=f"单次最多上传 {MAX_FILES} 张图片")

    results = []
    for upload in files:
        if upload.content_type not in ALLOWED_TYPES:
            raise HTTPException(
                415,
                detail=f"{upload.filename}: 不支持的文件类型 {upload.content_type}，仅接受 JPG/PNG/WEBP/BMP",
            )
        img_bytes = await upload.read()
        try:
            # 调用核心推理逻辑 (它现在应该会返回 location 和 timestamp)
            res = run_detect(img_bytes, conf=conf)
        except FileNotFoundError:
            raise HTTPException(
                503,
                detail="模型权重尚未就绪（best.pt 不存在），请等待训练完成后再试",
            )
        except ValueError as e:
            raise HTTPException(422, detail=str(e))

        # ==========================================
        # 将检测结果持久化到 PostgreSQL
        # ==========================================
        # 安全提取位置信息（防御空值）
        location = res.get("location", {})
        lat = location.get("lat", 0.0)
        lng = location.get("lng", 0.0)

        for det in res.get("detections", []):
            feature = det.get("feature")
            cluster_id = assign_cluster(lat, lng, det.get("label_cn"), feature, db)
            db_record = DiseaseRecord(
                filename=upload.filename,
                lat=lat,
                lng=lng,
                label=det.get("label"),
                label_cn=det.get("label_cn"),
                confidence=det.get("conf"),
                color_hex=det.get("color"),
                bbox=det.get("bbox"),
                feature_vector=feature,
                cluster_id=cluster_id,
                source_type=current_user.source_type or "manual",
                device_id=current_user.device_id,
                creator_id=current_user.id,
            )
            db.add(db_record)

        db.commit()

        results.append({
            "filename":     upload.filename,
            "detections":   res.get("detections", []),
            "image_b64":    res.get("image_b64", ""),
            "inference_ms": res.get("inference_ms", 0),
            "location":     location,
            "timestamp":    res.get("timestamp")
        })

    return JSONResponse(content=results)