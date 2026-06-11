from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    APP_NAME: str = "JobApply"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 jours

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/jobapply"

    # Redis (queue workers)
    REDIS_URL: str = "redis://localhost:6379/0"

    # Anthropic
    ANTHROPIC_API_KEY: str = ""
    DEFAULT_MODEL: str = "claude-sonnet-4-6"
    ANALYSIS_MODEL: str = "claude-haiku-4-5-20251001"

    # Storage (Supabase ou S3)
    STORAGE_BACKEND: str = "local"  # "local" | "supabase" | "s3"
    STORAGE_LOCAL_DIR: str = "/tmp/jobapply-files"
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    SUPABASE_BUCKET: str = "job-apply"
    S3_BUCKET: str = ""
    S3_REGION: str = "eu-west-3"
    AWS_ACCESS_KEY: str = ""
    AWS_SECRET_KEY: str = ""

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_PRO: str = ""        # price_xxx
    STRIPE_PRICE_UNLIMITED: str = ""

    # CORS
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "https://jobapply.fr"]

    # Playwright
    PLAYWRIGHT_HEADLESS: bool = True
    BROWSER_PROFILES_DIR: str = "/tmp/jobapply-browsers"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
