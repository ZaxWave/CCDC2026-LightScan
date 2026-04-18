# 🗄️ 数据库持久化层

本目录负责 LightScan 系统的所有持久化逻辑，采用 **PostgreSQL** + **SQLAlchemy ORM**。

## 核心数据表（三张）

### 表 1：`users`（用户信息）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | INTEGER PK | 用户唯一标识 |
| `username` | VARCHAR UNIQUE | 登录用户名 |
| `hashed_password` | VARCHAR | bcrypt 哈希密码 |
| `role` | VARCHAR | 权限角色（admin / worker） |
| `nickname` / `unit` | VARCHAR | 显示名称 / 所属单位 |
| `source_type` | VARCHAR | 设备类型（手持 / 行车记录仪 / 无人机） |
| `is_active` | BOOLEAN | 账号启用状态 |

### 表 2：`disease_clusters`（病害聚类主实体）

每行代表一个独立物理病害点，聚合多次观测记录。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `cluster_id` | VARCHAR PK | 病害点唯一标识（UUID） |
| `worker_id` | INTEGER FK→users | 负责巡检员 |
| `label_cn` | VARCHAR | 主要病害类型 |
| `canonical_lat/lng` | FLOAT | 病害点质心坐标（滑动均值） |
| `status` | VARCHAR | 工单状态（pending / processing / repaired） |
| `detection_count` | INTEGER | 累计检测次数 |
| `first/last_detected_at` | DATETIME | 首次 / 最近检测时间 |
| `repaired_at` | DATETIME | 修复完成时间 |
| `repaired_image_b64` | TEXT | 修复后照片 Base64 |

### 表 3：`disease_records`（病害检测记录）

每行为一次采集快照，通过 `cluster_id` 归属到聚类实体。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | SERIAL PK | 记录自增主键 |
| `cluster_id` | UUID FK→disease_clusters | 所属病害聚类 |
| `creator_id` | INTEGER FK→users | 上报用户 |
| `lat / lng` | FLOAT INDEX | WGS-84 地理空间坐标 |
| `label_cn` | VARCHAR | 病害中文类别（反范式冗余，加速 GIS 查询） |
| `confidence` | FLOAT | LS-Det 模型置信度分数 |
| `bbox` | JSONB | 检测框像素坐标 [x1,y1,x2,y2] |
| `feature_vector` | JSONB | 32 维 HSV 特征指纹（用于 ReID 匹配） |
| `source_type` | VARCHAR | 数据来源（移动上报 / 视频帧 / 图片检测） |
| `deleted_at` | DATETIME | 软删除时间戳，NULL 表示记录有效 |

## 启动自动建表

```python
# app/main.py 启动时自动执行
models.Base.metadata.create_all(bind=engine)
```

---

© 2026 LightScan Team. Licensed under Apache 2.0.
