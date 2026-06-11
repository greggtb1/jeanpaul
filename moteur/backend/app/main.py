"""
Point d'entrée FastAPI — JobApply SaaS.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.core.config import settings
from app.database import init_db
from app.routes import auth, jobs, tasks, billing, profile


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="JobApply API",
    description="Automatise ta recherche d'emploi — scraping, scoring, génération, autofill.",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(tasks.router)
app.include_router(billing.router)
app.include_router(profile.router)

# Serve uploaded files en local dev
local_files = Path(settings.STORAGE_LOCAL_DIR)
local_files.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(local_files)), name="files")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
