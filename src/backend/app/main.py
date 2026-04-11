from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

app = FastAPI(title="LightScan API")

# 获取前端目录的绝对路径
frontend_path = os.path.join(os.getcwd(), "../../frontend/public")

# 1. 静态文件挂载（如果以后有 css/js 文件）
# app.mount("/static", StaticFiles(directory=frontend_path), name="static")

# 2. 访问根目录直接返回 index.html
@app.get("/")
async def read_index():
    return FileResponse(os.path.join(frontend_path, "index.html"))

@app.get("/health")
async def health():
    return {"status": "ok"}