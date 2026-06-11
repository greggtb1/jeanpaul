"""
Routes profil — données candidat + upload CV de base.
"""
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import User, UserProfile
from app.core.auth import get_current_user
from app.services.storage import upload_file

router = APIRouter(prefix="/api/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    postcode: Optional[str] = None
    country: Optional[str] = None
    linkedin_url: Optional[str] = None
    website_url: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    availability: Optional[str] = None
    notice_period: Optional[str] = None
    target_roles: Optional[list] = None
    tagline: Optional[str] = None
    summary: Optional[str] = None
    experiences: Optional[list] = None
    education: Optional[list] = None
    skills: Optional[list] = None
    tools: Optional[dict] = None
    languages: Optional[list] = None


@router.get("")
async def get_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_profile(user.id, db)
    return _profile_out(profile)


@router.patch("")
async def update_profile(
    data: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_profile(user.id, db)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(profile, field, value)
    await db.commit()
    await db.refresh(profile)
    return _profile_out(profile)


@router.post("/cv")
async def upload_base_cv(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload le CV de base (PDF) — sera utilisé comme point de départ pour les adaptations."""
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Le CV doit être un fichier PDF.")

    content = await file.read()
    url = await upload_file(
        content=content,
        filename=f"users/{user.id}/cv_base.pdf",
        content_type="application/pdf",
    )

    profile = await _get_profile(user.id, db)
    profile.cv_base_url = url
    from datetime import datetime
    profile.cv_updated_at = datetime.utcnow()
    await db.commit()

    return {"cv_url": url}


async def _get_profile(user_id, db: AsyncSession) -> UserProfile:
    result = await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    profile = result.scalar_one_or_none()
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        await db.flush()
    return profile


def _profile_out(p: UserProfile) -> dict:
    return {
        "first_name": p.first_name,
        "last_name": p.last_name,
        "phone": p.phone,
        "location": p.location,
        "city": p.city,
        "postcode": p.postcode,
        "country": p.country,
        "linkedin_url": p.linkedin_url,
        "website_url": p.website_url,
        "salary_min": p.salary_min,
        "salary_max": p.salary_max,
        "availability": p.availability,
        "notice_period": p.notice_period,
        "target_roles": p.target_roles,
        "tagline": p.tagline,
        "summary": p.summary,
        "experiences": p.experiences,
        "education": p.education,
        "skills": p.skills,
        "tools": p.tools,
        "languages": p.languages,
        "cv_base_url": p.cv_base_url,
        "cv_updated_at": p.cv_updated_at.isoformat() if p.cv_updated_at else None,
    }
