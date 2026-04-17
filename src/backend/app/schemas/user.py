from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional
from datetime import datetime


class UserBase(BaseModel):
    username: str
    role: Optional[str] = "worker"


class UserCreate(UserBase):
    password: str


class UserOut(UserBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class UserProfile(BaseModel):
    """用于 /users/me 返回的完整个人信息"""
    id: int
    username: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None
    record_count: int = 0
    nickname:    Optional[str] = None
    unit:        Optional[str] = None
    source_type: Optional[str] = "manual"
    device_id:   Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    """PATCH /users/me 请求体"""
    nickname:    Optional[str] = None
    unit:        Optional[str] = None
    source_type: Optional[str] = None
    device_id:   Optional[str] = None


class PasswordChange(BaseModel):
    old_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("新密码至少需要 6 位")
        return v


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: Optional[str] = None
