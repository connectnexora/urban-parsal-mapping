"""
AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction
FastAPI backend — STEP 1: project structure + frontend/backend connection only.

No AI inference is implemented yet (Step 2 will add YOLO + OpenCV segmentation).
Endpoints here only prove connectivity and accept file uploads without
returning fake detection results.
"""

from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
UPLOAD_DIR = PROJECT_ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}

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


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    """
    Accept an image and save it to data/uploads/.
    Deliberately returns NO detections — Step 2 will add real AI.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_name = f"{timestamp}_{Path(file.filename or 'upload').name}"
    dest = UPLOAD_DIR / safe_name

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file received.")

    dest.write_bytes(content)

    return JSONResponse(
        status_code=201,
        content={
            "message": "File received. AI analysis is not implemented yet (Step 2).",
            "filename": safe_name,
            "size_bytes": len(content),
            "ai_status": "not_implemented",
            "detections": None,  # explicitly null — no fake results
        },
    )
