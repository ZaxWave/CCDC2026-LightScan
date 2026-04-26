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
from app.api.v1.disease import router as disease_router

from sqlalchemy import inspect, text
from .db.database import engine
from .db import models

# 初始化数据库（自动建表）
models.Base.metadata.create_all(bind=engine)

# ── 热升级迁移（幂等）────────────────────────────────────────────────────────────

def _migrate_disease_records():
    """为 disease_records / users 表补充历史遗留字段。"""
    try:
        with engine.connect() as conn:
            cols = {c["name"] for c in inspect(engine).get_columns("disease_records")}
            new_cols = {
                "status":             "ALTER TABLE disease_records ADD COLUMN status VARCHAR NOT NULL DEFAULT 'pending'",
                "worker_name":        "ALTER TABLE disease_records ADD COLUMN worker_name VARCHAR",
                "cluster_id":         "ALTER TABLE disease_records ADD COLUMN cluster_id VARCHAR",
                "feature_vector":     "ALTER TABLE disease_records ADD COLUMN feature_vector JSONB",
                "source_type":        "ALTER TABLE disease_records ADD COLUMN source_type VARCHAR",
                "device_id":          "ALTER TABLE disease_records ADD COLUMN device_id VARCHAR",
                "repaired_image_b64": "ALTER TABLE disease_records ADD COLUMN repaired_image_b64 TEXT",
                "repaired_at":        "ALTER TABLE disease_records ADD COLUMN repaired_at TIMESTAMP",
                "dispatch_info":      "ALTER TABLE disease_records ADD COLUMN dispatch_info JSONB",
                "thumbnail_b64":      "ALTER TABLE disease_records ADD COLUMN thumbnail_b64 TEXT",
            }
            for col, ddl in new_cols.items():
                if col not in cols:
                    conn.execute(text(ddl))
            conn.commit()

        user_cols = {c["name"] for c in inspect(engine).get_columns("users")}
        with engine.connect() as conn:
            if "source_type" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN source_type VARCHAR DEFAULT 'manual'"))
            if "device_id" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN device_id VARCHAR"))
            conn.commit()

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


def _migrate_clusters_v2():
    """为 disease_clusters 补充严重等级、优先级、软删除字段。"""
    try:
        cluster_cols = {c["name"] for c in inspect(engine).get_columns("disease_clusters")}
        with engine.connect() as conn:
            if "severity" not in cluster_cols:
                conn.execute(text("ALTER TABLE disease_clusters ADD COLUMN severity INTEGER"))
            if "priority" not in cluster_cols:
                conn.execute(text("ALTER TABLE disease_clusters ADD COLUMN priority INTEGER"))
            if "deleted_at" not in cluster_cols:
                conn.execute(text("ALTER TABLE disease_clusters ADD COLUMN deleted_at TIMESTAMP"))
            conn.commit()
    except Exception as e:
        warnings.warn(f"⚠️ Cluster v2 migration warning: {e}", RuntimeWarning)


def _migrate_audit_log():
    """创建审计日志表：记录每次状态流转（谁、何时、从何状态变为何状态）。"""
    try:
        existing_tables = inspect(engine).get_table_names()
        if "audit_log" not in existing_tables:
            with engine.connect() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS audit_log (
                        id          SERIAL PRIMARY KEY,
                        entity_type VARCHAR NOT NULL,
                        entity_id   VARCHAR NOT NULL,
                        from_status VARCHAR,
                        to_status   VARCHAR NOT NULL,
                        operator_id INTEGER REFERENCES users(id),
                        changed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                        note        VARCHAR
                    )
                """))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_log_entity ON audit_log(entity_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_log_changed_at ON audit_log(changed_at)"))
                conn.commit()
    except Exception as e:
        warnings.warn(f"⚠️ Audit log migration warning: {e}", RuntimeWarning)


def _migrate_disease_media():
    """创建大字段分离表：图片路径/Base64 独立存储，防止主表体积膨胀。"""
    try:
        existing_tables = inspect(engine).get_table_names()
        if "disease_media" not in existing_tables:
            with engine.connect() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS disease_media (
                        id          SERIAL PRIMARY KEY,
                        cluster_id  VARCHAR REFERENCES disease_clusters(cluster_id),
                        record_id   INTEGER REFERENCES disease_records(id),
                        media_type  VARCHAR NOT NULL,
                        storage_url VARCHAR,
                        b64_data    TEXT,
                        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                """))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_disease_media_cluster ON disease_media(cluster_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_disease_media_record ON disease_media(record_id)"))
                conn.commit()
    except Exception as e:
        warnings.warn(f"⚠️ Disease media migration warning: {e}", RuntimeWarning)


def _migrate_postgis():
    """安装 PostGIS 并为 disease_clusters 添加 location 几何列 + GIST 空间索引。
    需要 PostgreSQL + PostGIS 扩展；SQLite 开发模式下安全跳过。"""
    db_url = str(engine.url)
    if "postgresql" not in db_url:
        return
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            conn.commit()

        cluster_cols = {c["name"] for c in inspect(engine).get_columns("disease_clusters")}
        with engine.connect() as conn:
            if "location" not in cluster_cols:
                conn.execute(text(
                    "ALTER TABLE disease_clusters "
                    "ADD COLUMN location geometry(Point, 4326)"
                ))
                # 回填已有行
                conn.execute(text(
                    "UPDATE disease_clusters "
                    "SET location = ST_SetSRID(ST_MakePoint(canonical_lng, canonical_lat), 4326) "
                    "WHERE canonical_lat != 0 OR canonical_lng != 0"
                ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_clusters_location_gist "
                "ON disease_clusters USING GIST(location)"
            ))
            conn.commit()
        logger.info("✅ PostGIS 空间索引就绪")
    except Exception as e:
        warnings.warn(f"⚠️ PostGIS migration warning (non-fatal): {e}", RuntimeWarning)


def _install_cluster_stats_trigger():
    """安装数据库触发器：disease_records 插入/更新时自动维护 cluster 的
    detection_count 和 last_detected_at，消除应用层手动同步的数据不一致风险。
    仅 PostgreSQL 支持；SQLite 开发模式下安全跳过。"""
    db_url = str(engine.url)
    if "postgresql" not in db_url:
        return
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE OR REPLACE FUNCTION fn_sync_cluster_stats()
                RETURNS TRIGGER AS $$
                DECLARE
                    v_cid VARCHAR;
                BEGIN
                    v_cid := COALESCE(NEW.cluster_id, OLD.cluster_id);
                    IF v_cid IS NOT NULL THEN
                        UPDATE disease_clusters
                        SET
                            detection_count  = (
                                SELECT COUNT(*) FROM disease_records
                                WHERE cluster_id = v_cid AND deleted_at IS NULL
                            ),
                            last_detected_at = (
                                SELECT MAX(timestamp) FROM disease_records
                                WHERE cluster_id = v_cid AND deleted_at IS NULL
                            )
                        WHERE cluster_id = v_cid;
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
            """))
            conn.execute(text("DROP TRIGGER IF EXISTS trg_cluster_stats ON disease_records"))
            conn.execute(text("""
                CREATE TRIGGER trg_cluster_stats
                AFTER INSERT OR UPDATE ON disease_records
                FOR EACH ROW EXECUTE FUNCTION fn_sync_cluster_stats()
            """))
            conn.commit()
        logger.info("✅ cluster_stats 触发器已安装")
    except Exception as e:
        warnings.warn(f"⚠️ Trigger installation warning (non-fatal): {e}", RuntimeWarning)


_migrate_disease_records()
_migrate_clusters_v2()
_migrate_audit_log()
_migrate_disease_media()
_migrate_postgis()
_install_cluster_stats_trigger()

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
app.include_router(disease_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── 前端静态文件（最后挂载，避免拦截 /api/*）─────────────────────────────────
app.mount("/", StaticFiles(directory=str(FRONTEND_PUBLIC), html=True), name="frontend")
