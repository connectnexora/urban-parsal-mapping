"""
AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction
FastAPI backend — STEP 1: project structure + frontend/backend connection only.

No AI inference is implemented yet (Step 2 will add YOLO + OpenCV segmentation).
Endpoints here only prove connectivity and accept file uploads without
returning fake detection results.
"""

from pathlib import Path
from datetime import datetime, timezone
import re
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from PIL import Image, UnidentifiedImageError

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
UPLOAD_DIR = PROJECT_ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}

# Prototype cap — drone frames are big, but bound memory per request.
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Urban Parcel Mapping API",
    description="Drone imagery -> AI parcel mapping. Step 1: connectivity only.",
    version="0.1.0",
)

# Allow the Vite React dev server to call the API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    """Root endpoint — quick human-readable check."""
    return {
        "service": "Urban Parcel Mapping API",
        "version": "0.1.0",
        "status": "running",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/api/health")
def health():
    """Health check used by the frontend 'Test Connection' button."""
    return {
        "status": "ok",
        "service": "urban-parcel-mapping-backend",
        "version": "0.1.0",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/api/info")
def info():
    """Describe the planned pipeline (no AI execution yet)."""
    return {
        "pipeline": [
            "1. Upload drone/aerial image",
            "2. AI analysis (YOLO detection + segmentation) — NOT IMPLEMENTED YET (Step 2)",
            "3. Boundary extraction + area calculation — NOT IMPLEMENTED YET",
            "4. Interactive map overlay — frontend shell ready",
            "5. Parcel/property report — NOT IMPLEMENTED YET",
        ],
        "stack": {
            "frontend": "React + Vite + Leaflet",
            "backend": "FastAPI",
            "ai": "OpenCV + YOLO (Step 2)",
        },
        "ai_status": "not_implemented",
    }


_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _sanitize_filename(name: str) -> str:
    """Strip directories and unsafe characters to prevent path traversal."""
    base = Path(name or "").name.strip().lstrip(".")
    base = _FILENAME_SAFE.sub("_", base)
    if not base or base in {".", ".."}:
        return "upload"
    if len(base) > 100:
        stem, dot, ext = base.rpartition(".")
        base = (stem[:90] + dot + ext) if dot else base[:100]
    return base


def _read_dimensions(path: Path) -> tuple:
    """Return (width, height) in pixels. Raises HTTPException if unreadable."""
    try:
        with Image.open(path) as img:
            width, height = img.size
            img.load()  # force full decode — catches truncated/corrupt files
    except Image.DecompressionBombError as exc:
        raise HTTPException(status_code=413, detail=f"Image pixel dimensions too large: {exc}") from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"File is not a readable image: {exc}") from exc
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="Image has invalid dimensions.")
    return width, height


async def _store_upload(file: UploadFile) -> dict:
    """Validate an upload, save it to data/uploads/, describe it. No AI runs here."""
    original = file.filename or ""
    suffix = Path(original).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix or '(none)'}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Empty file received.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content)} bytes). Limit is {MAX_UPLOAD_BYTES} bytes.",
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_name = f"{stamp}_{uuid.uuid4().hex[:6]}_{_sanitize_filename(original)}"
    dest = UPLOAD_DIR / safe_name
    try:
        dest.write_bytes(content)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not save upload: {exc}") from exc

    try:
        width, height = _read_dimensions(dest)
    except HTTPException:
        dest.unlink(missing_ok=True)  # don't keep invalid files around
        raise

    return {
        "filename": safe_name,
        "original_filename": original,
        "width": width,
        "height": height,
        "size_bytes": len(content),
        "status": "uploaded",
    }


@app.post("/upload", status_code=201)
async def upload(file: UploadFile = File(...)):
    """
    Receive a drone image, validate it, save it to data/uploads/,
    and return filename, image dimensions, file size and upload status.
    No AI detection runs on this endpoint.
    """
    return await _store_upload(file)


@app.post("/api/upload", status_code=201)
async def upload_image(file: UploadFile = File(...)):
    """
    Same storage + validation as POST /upload; kept for the Vite dev
    proxy and the existing UI. Deliberately returns NO detections —
    Step 2 will add real AI.
    """
    stored = await _store_upload(file)
    return JSONResponse(
        status_code=201,
        content={
            **stored,
            "message": "File received. AI analysis is not implemented yet (Step 2).",
            "ai_status": "not_implemented",
            "detections": None,  # explicitly null — no fake results
        },
    )
