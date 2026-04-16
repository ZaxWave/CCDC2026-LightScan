import os
import json
import warnings
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

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

from .db.database import engine
from .db import models

# 初始化数据库（自动建表）
models.Base.metadata.create_all(bind=engine)

# 路径配置
ROOT = Path(__file__).resolve().parents[3]  # → CCDC2026-LightScan/
FRONTEND_PUBLIC = ROOT / "src" / "frontend" / "public"

app = FastAPI(title="LightScan API", version="0.1.0")

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


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── 前端静态文件（最后挂载，避免拦截 /api/*）─────────────────────────────────
app.mount("/", StaticFiles(directory=str(FRONTEND_PUBLIC), html=True), name="frontend")
