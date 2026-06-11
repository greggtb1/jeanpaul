from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.models import User, UserProfile
from app.core.auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    plan: str


@router.post("/signup", response_model=TokenResponse)
async def signup(data: SignupRequest, db: AsyncSession = Depends(get_db)):
    # Check email déjà utilisé
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email déjà utilisé.")

    user = User(
        email=data.email,
        hashed_pw=hash_password(data.password),
        full_name=data.full_name,
    )
    db.add(user)
    await db.flush()

    # Crée le profil vide
    profile = UserProfile(user_id=user.id)
    db.add(profile)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user_id=str(user.id), email=user.email, plan=user.plan)


@router.post("/login", response_model=TokenResponse)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.hashed_pw):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect.")

    user.last_login = datetime.utcnow()
    await db.commit()

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user_id=str(user.id), email=user.email, plan=user.plan)


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "plan": user.plan,
        "created_at": user.created_at,
    }
