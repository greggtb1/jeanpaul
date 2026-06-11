"""
Database models — SQLAlchemy + PostgreSQL
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime,
    Text, JSON, ForeignKey, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, DeclarativeBase
import enum


class Base(DeclarativeBase):
    pass


# ── Enums ──────────────────────────────────────────────────────────────────────

class PlanType(str, enum.Enum):
    free   = "free"
    pro    = "pro"       # 29€/mois, 50 candidatures
    unlimited = "unlimited"  # 49€/mois


class JobStatus(str, enum.Enum):
    new       = "new"
    analyzed  = "analyzed"
    generated = "generated"   # CV + lettre générés
    filled    = "filled"      # formulaire rempli, en attente submit
    submitted = "submitted"
    rejected  = "rejected"
    interview = "interview"
    deleted   = "deleted"


class TaskStatus(str, enum.Enum):
    pending  = "pending"
    running  = "running"
    done     = "done"
    failed   = "failed"


# ── Modèles ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email         = Column(String(255), unique=True, nullable=False, index=True)
    hashed_pw     = Column(String(255), nullable=False)
    full_name     = Column(String(255))
    created_at    = Column(DateTime, default=datetime.utcnow)
    last_login    = Column(DateTime)
    is_active     = Column(Boolean, default=True)

    # Plan / billing
    plan          = Column(SAEnum(PlanType), default=PlanType.free)
    stripe_customer_id     = Column(String(255))
    stripe_subscription_id = Column(String(255))
    plan_expires_at = Column(DateTime)

    # Anthropic key (optionnel — sinon on utilise la clé plateforme)
    anthropic_key = Column(String(255))

    # Relations
    profile       = relationship("UserProfile", back_populates="user", uselist=False, cascade="all, delete")
    jobs          = relationship("Job", back_populates="user", cascade="all, delete")
    search_configs = relationship("SearchConfig", back_populates="user", cascade="all, delete")
    tasks         = relationship("Task", back_populates="user", cascade="all, delete")


class UserProfile(Base):
    """Données du candidat — equivalent du PROFILE + CANDIDATE dans le code local."""
    __tablename__ = "user_profiles"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)

    # Infos personnelles
    first_name   = Column(String(100))
    last_name    = Column(String(100))
    phone        = Column(String(50))
    location     = Column(String(255))
    city         = Column(String(100))
    postcode     = Column(String(20))
    country      = Column(String(100), default="France")
    linkedin_url = Column(String(500))
    website_url  = Column(String(500))
    github_url   = Column(String(500))

    # Job search prefs
    salary_min   = Column(Integer)
    salary_max   = Column(Integer)
    availability = Column(String(100))
    notice_period = Column(String(100))
    target_roles  = Column(JSON)   # ["ops manager", "head of ops"]
    target_locations = Column(JSON)  # ["Paris", "Remote"]

    # CV content (structured)
    tagline      = Column(Text)
    summary      = Column(Text)
    experiences  = Column(JSON)   # [{company, title, period, bullets:[]}]
    education    = Column(JSON)   # [{school, degree, period}]
    skills       = Column(JSON)   # ["ops", "python", "sql"]
    tools        = Column(JSON)   # {dev: [], automation: [], analytics: []}
    languages    = Column(JSON)   # [{lang, level}]

    # CV PDF (stocké sur S3/Supabase)
    cv_base_url  = Column(String(500))  # URL du CV de base (non adapté)
    cv_updated_at = Column(DateTime)

    user         = relationship("User", back_populates="profile")


class SearchConfig(Base):
    """Config de recherche d'offres pour un utilisateur."""
    __tablename__ = "search_configs"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    name         = Column(String(255), default="Ma recherche")

    platforms    = Column(JSON, default=["linkedin", "wttj"])  # sources actives
    queries      = Column(JSON)   # mots-clés de recherche
    locations    = Column(JSON, default=["Paris"])
    min_score    = Column(Integer, default=6)
    max_per_run  = Column(Integer, default=10)
    exclude_keywords = Column(JSON, default=[])
    require_keywords = Column(JSON, default=[])
    recent_days  = Column(Integer, default=7)

    # Schedule
    auto_run     = Column(Boolean, default=False)
    cron         = Column(String(100), default="0 7 * * *")  # 7h chaque matin

    created_at   = Column(DateTime, default=datetime.utcnow)
    user         = relationship("User", back_populates="search_configs")


class Job(Base):
    """Une offre d'emploi scrappée pour un utilisateur."""
    __tablename__ = "jobs"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # Données de l'offre
    title        = Column(String(500))
    company      = Column(String(255))
    location     = Column(String(255))
    url          = Column(String(1000))
    platform     = Column(String(50))   # linkedin, wttj, indeed
    description  = Column(Text)
    salary_raw   = Column(String(255))
    published_at = Column(DateTime)
    scraped_at   = Column(DateTime, default=datetime.utcnow)

    # Analyse Claude
    fit_score    = Column(Integer)      # /10
    fit_reasoning = Column(Text)
    role_summary = Column(Text)
    key_responsibilities = Column(JSON)
    required_skills = Column(JSON)
    why_interesting = Column(Text)
    language     = Column(String(10), default="fr")

    # Statut
    status       = Column(SAEnum(JobStatus), default=JobStatus.new, index=True)
    is_seen      = Column(Boolean, default=False)
    notes        = Column(Text)

    # Fichiers générés (URLs S3/Supabase)
    cv_url       = Column(String(1000))
    letter_url   = Column(String(1000))

    # Autofill
    autofill_done = Column(Boolean, default=False)
    autofill_answers = Column(JSON)   # cache des réponses formulaire
    submitted_at  = Column(DateTime)
    interview_at  = Column(DateTime)

    user         = relationship("User", back_populates="jobs")


class Task(Base):
    """Tâche de fond (scraping, analyse, génération, autofill)."""
    __tablename__ = "tasks"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id       = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)

    type         = Column(String(50))   # scrape | analyze | generate | autofill | pipeline
    status       = Column(SAEnum(TaskStatus), default=TaskStatus.pending, index=True)
    payload      = Column(JSON)         # paramètres de la tâche
    result       = Column(JSON)         # résultat ou erreur
    log          = Column(Text)         # logs temps-réel (streamés au frontend via SSE)
    progress     = Column(Integer, default=0)  # 0-100

    created_at   = Column(DateTime, default=datetime.utcnow)
    started_at   = Column(DateTime)
    finished_at  = Column(DateTime)

    user         = relationship("User", back_populates="tasks")


class BillingEvent(Base):
    """Historique des events de facturation Stripe."""
    __tablename__ = "billing_events"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    stripe_event_id = Column(String(255), unique=True)
    type         = Column(String(100))
    payload      = Column(JSON)
    created_at   = Column(DateTime, default=datetime.utcnow)
