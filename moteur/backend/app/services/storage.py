"""
Service storage — local / Supabase / S3.
On change le backend via la config sans toucher au code appelant.
"""
import os
from pathlib import Path
from app.core.config import settings


async def upload_file(content: bytes, filename: str, content_type: str) -> str:
    """Upload async — retourne l'URL publique."""
    if settings.STORAGE_BACKEND == "supabase":
        return await _supabase_upload(content, filename, content_type)
    elif settings.STORAGE_BACKEND == "s3":
        return await _s3_upload(content, filename, content_type)
    else:
        return _local_upload(content, filename)


def upload_file_sync(path: str, filename: str, content_type: str) -> str:
    """Version sync pour les workers RQ."""
    with open(path, "rb") as f:
        content = f.read()
    if settings.STORAGE_BACKEND == "supabase":
        import asyncio
        return asyncio.run(_supabase_upload(content, filename, content_type))
    elif settings.STORAGE_BACKEND == "s3":
        return _s3_upload_sync(content, filename, content_type)
    else:
        return _local_upload(content, filename)


def download_file_sync(url: str, dest: Path):
    """Télécharge un fichier depuis l'URL storage vers un chemin local."""
    if settings.STORAGE_BACKEND == "local":
        # URL locale → copie directe
        local_path = Path(settings.STORAGE_LOCAL_DIR) / url.lstrip("/")
        import shutil
        shutil.copy(local_path, dest)
    else:
        import httpx
        r = httpx.get(url, timeout=30)
        r.raise_for_status()
        dest.write_bytes(r.content)


# ── Backends ───────────────────────────────────────────────────────────────────

def _local_upload(content: bytes, filename: str) -> str:
    base = Path(settings.STORAGE_LOCAL_DIR)
    full = base / filename
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(content)
    return f"/files/{filename}"


async def _supabase_upload(content: bytes, filename: str, content_type: str) -> str:
    from supabase import create_client
    sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    sb.storage.from_(settings.SUPABASE_BUCKET).upload(
        filename, content, {"content-type": content_type, "upsert": "true"}
    )
    return sb.storage.from_(settings.SUPABASE_BUCKET).get_public_url(filename)


def _s3_upload_sync(content: bytes, filename: str, content_type: str) -> str:
    import boto3
    s3 = boto3.client(
        "s3",
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY,
        aws_secret_access_key=settings.AWS_SECRET_KEY,
    )
    s3.put_object(
        Bucket=settings.S3_BUCKET,
        Key=filename,
        Body=content,
        ContentType=content_type,
    )
    return f"https://{settings.S3_BUCKET}.s3.{settings.S3_REGION}.amazonaws.com/{filename}"
