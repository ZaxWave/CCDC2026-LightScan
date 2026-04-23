import logging
import os
import json
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

logger = logging.getLogger("uvicorn.error")

# Load environment variables
_env_path = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=_env_path)

# 引入所有路由模块
from app.api.v1.detect import router as detect_router
from app.api.v1.detect_video import router as detect_video_router
from app.api.v1.gis import router as gis_router
from app.api.v1.auth import router as auth_router
from app.api.v1.users import router as users_router
from app.api.v1.report import router as report_router
from app.api.v1.ai_report import router as ai_report_router

from sqlalchemy import inspect, text
from .db.database import engine
from .db import models

# 初始化数据库（自动建表）
models.Base.metadata.create_all(bind=engine)

# 热升级：为已有 disease_records 表补充新字段（幂等）
def _migrate_disease_records():
    try:
        with engine.connect() as conn:
            cols = {c["name"] for c in inspect(engine).get_columns("disease_records")}
            if "status" not in cols:
                conn.execute(text(
                    "ALTER TABLE disease_records ADD COLUMN status VARCHAR NOT NULL DEFAULT 'pending'"
                ))
            if "worker_name" not in cols:
                conn.execute(text(
                    "ALTER TABLE disease_records ADD COLUMN worker_name VARCHAR"
                ))
            if "cluster_id" not in cols:
                conn.execute(text("ALTER TABLE disease_records ADD COLUMN cluster_id VARCHAR"))
            if "feature_vector" not in cols:
                conn.execute(text("ALTER TABLE disease_records ADD COLUMN feature_vector JSONB"))
            if "source_type" not in cols:
                conn.execute(text("ALTER TABLE disease_records ADD COLUMN source_type VARCHAR"))
            if "device_id" not in cols:
                conn.execute(text("ALTER TABLE disease_records ADD COLUMN device_id VARCHAR"))
            if "repaired_image_b64" not in cols:
                conn.execute(text("ALTER TABLE disease_records ADD COLUMN repaired_image_b64 TEXT"))
            if "repaired_at" not in cols:
                conn.execute(text("ALTER TABLE disease_records ADD COLUMN repaired_at TIMESTAMP"))
            conn.commit()

        # users 表补充设备字段
        user_cols = {c["name"] for c in inspect(engine).get_columns("users")}
        with engine.connect() as conn:
            if "source_type" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN source_type VARCHAR DEFAULT 'manual'"))
            if "device_id" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN device_id VARCHAR"))
            conn.commit()

        # disease_clusters 表（文档 Table 5 主实体）
        existing_tables = inspect(engine).get_table_names()
        if "disease_clusters" not in existing_tables:
            with engine.connect() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS disease_clusters (
                        cluster_id         VARCHAR PRIMARY KEY,
                        worker_id          INTEGER REFERENCES users(id),
                        label_cn           VARCHAR NOT NULL,
                        canonical_lat      FLOAT NOT NULL,
                        canonical_lng      FLOAT NOT NULL,
                        status             VARCHAR NOT NULL DEFAULT 'pending',
                        detection_count    INTEGER NOT NULL DEFAULT 1,
                        first_detected_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                        last_detected_at   TIMESTAMP NOT NULL DEFAULT NOW(),
                        repaired_at        TIMESTAMP,
                        repaired_image_b64 TEXT
                    )
                """))
                conn.commit()
    except Exception as e:
        warnings.warn(f"⚠️ DB migration warning: {e}", RuntimeWarning)

_migrate_disease_records()

# 路径配置
ROOT = Path(__file__).resolve().parents[3]  # → CCDC2026-LightScan/
FRONTEND_PUBLIC = ROOT / "src" / "frontend" / "public"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── 启动阶段：预热模型，避免首次请求延迟与显存争抢 ──────────────
    logger.info("⚡ 预加载 ls-det 推理引擎...")
    from app.services.inference_service import preload_model
    preload_model()
    logger.info("✅ ls-det 模型已就绪")

    if os.getenv("PRELOAD_OCR", "true").lower() == "true":
        logger.info("⚡ 预加载 OCR 引擎（PaddleOCR 首次加载约需数分钟）...")
        try:
            from app.services.video_service import _get_ocr_engine
            _get_ocr_engine()
            logger.info("✅ OCR 引擎已就绪")
        except Exception as e:
            logger.warning(f"⚠️ OCR 引擎预加载失败（不影响 GPS/Timed 模式）: {e}")

    yield

    # ── 关闭阶段：优雅释放线程池 ────────────────────────────────────
    from app.services.inference_service import _inference_executor
    from app.api.v1.detect_video import _video_executor
    _inference_executor.shutdown(wait=False)
    _video_executor.shutdown(wait=False)
    logger.info("🔒 ls-det 线程池已关闭")


app = FastAPI(title="LightScan API", version="0.1.0", lifespan=lifespan)

# ── CORS ──────────────────────────────────────────────────────────────────────
cors_origins_str = os.getenv(
    "CORS_ORIGINS",
    '["http://localhost:3000","http://localhost:5173","http://localhost:8000"]',
)
try:
    cors_origins = json.loads(cors_origins_str)
except json.JSONDecodeError:
    cors_origins = ["http://localhost:3000", "http://localhost:5173", "http://localhost:8000"]
    warnings.warn("⚠️ Invalid CORS_ORIGINS JSON. Using development defaults.", RuntimeWarning)

environment = os.getenv("ENVIRONMENT", "development")
if "*" in cors_origins and environment == "production":
    warnings.warn("⚠️ CORS allows all origins in production — set CORS_ORIGINS.", RuntimeWarning)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── API 路由（必须在静态文件挂载之前注册）───────────────────────────────────────
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(report_router)
app.include_router(detect_router)
app.include_router(detect_video_router)
app.include_router(gis_router)
app.include_router(ai_report_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── 前端静态文件（最后挂载，避免拦截 /api/*）─────────────────────────────────
app.mount("/", StaticFiles(directory=str(FRONTEND_PUBLIC), html=True), name="frontend")
