"""
/api/v1/users — 个人设置模块
  GET  /me           查看个人信息（含我的检出总数）
  POST /me/password  修改密码
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import DiseaseRecord, User
from app.schemas.user import PasswordChange, UserProfile, UserUpdate
from app.core.security import get_password_hash, verify_password
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/v1/users", tags=["Users"])


@router.get("/me", response_model=UserProfile)
def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户信息 + 个人检出统计"""
    record_count = (
        db.query(func.count(DiseaseRecord.id))
        .filter(DiseaseRecord.creator_id == current_user.id)
        .scalar()
        or 0
    )
    return UserProfile(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        record_count=record_count,
        nickname=current_user.nickname,
        unit=current_user.unit,
        source_type=current_user.source_type,
        device_id=current_user.device_id,
    )


@router.patch("/me", response_model=UserProfile)
def update_my_profile(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """修改个人资料（昵称、单位）"""
    if body.nickname is not None:
        current_user.nickname = body.nickname.strip() or None
    if body.unit is not None:
        current_user.unit = body.unit.strip() or None
    if body.source_type is not None:
        current_user.source_type = body.source_type or "manual"
    if body.device_id is not None:
        current_user.device_id = body.device_id.strip() or None
    db.commit()
    db.refresh(current_user)
    record_count = (
        db.query(func.count(DiseaseRecord.id))
        .filter(DiseaseRecord.creator_id == current_user.id)
        .scalar()
        or 0
    )
    return UserProfile(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        record_count=record_count,
        nickname=current_user.nickname,
        unit=current_user.unit,
        source_type=current_user.source_type,
        device_id=current_user.device_id,
    )


@router.post("/me/password")
def change_password(
    body: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """修改密码：验证旧密码后更新"""
    if not verify_password(body.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="原密码错误")
    current_user.hashed_password = get_password_hash(body.new_password)
    db.commit()
    return {"message": "密码修改成功"}
