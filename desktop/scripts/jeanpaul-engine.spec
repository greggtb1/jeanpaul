# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import playwright

SPEC_DIR = Path(SPEC).resolve().parent
ROOT = SPEC_DIR.parent.parent
ENGINE = ROOT / "engine"
PW_DRIVER = Path(playwright.__file__).resolve().parent / "driver"

a = Analysis(
    [str(ENGINE / "run_for_user.py")],
    pathex=[str(ENGINE)],
    binaries=[],
    datas=[
        (str(ENGINE / "scrapers"), "scrapers"),
        (str(ENGINE / "generators"), "generators"),
        (str(ENGINE / "utils"), "utils"),
        (str(ENGINE / "config.yaml"), "."),
        (str(PW_DRIVER), "playwright/driver"),
    ],
    hiddenimports=[
        "store",
        "main",
        "playwright",
        "playwright.sync_api",
        "anthropic",
        "supabase",
        "dotenv",
        "rich",
        "click",
        "yaml",
        "bs4",
        "lxml",
        "docx",
        "reportlab",
        "pypdf",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="jeanpaul-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
