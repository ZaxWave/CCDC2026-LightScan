from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# 引入所有路由模块
from app.api.v1.detect import router as detect_router
from app.api.v1.detect_video import router as detect_video_router
from app.api.v1.gis import router as gis_router 
from app.api.v1.auth import router as auth_router  

from .db.database import engine
from .db import models

# 初始化数据库（自动创建 users 表）
models.Base.metadata.create_all(bind=engine)

# 路径配置
ROOT = Path(__file__).resolve().parents[3]  # → CCDC2026-LightScan/
FRONTEND_PUBLIC = ROOT / "src" / "frontend" / "public"

app = FastAPI(title="LightScan API", version="0.1.0")

# CORS 跨域配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API 路由
app.include_router(auth_router)         
app.include_router(detect_router)
app.include_router(detect_video_router)
app.include_router(gis_router)

# 健康检查
@app.get("/health")
async def health():
    return {"status": "ok"}

# 前端静态文件（最后注册，避免拦截 /api/*）
app.mount("/", StaticFiles(directory=str(FRONTEND_PUBLIC), html=True), name="frontend")