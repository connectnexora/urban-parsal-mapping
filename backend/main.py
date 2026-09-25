"""
AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction
FastAPI backend — STEP 2: YOLO-based building detection.

- Model is loaded SAFELY once at startup (never crashes the server when the
  weight file is missing — endpoints then return HTTP 503 with instructions).
- POST /detect/buildings accepts a drone image, runs real YOLO inference
  (no hardcoded boxes), returns structured JSON + saves an annotated image
  under outputs/ served at /outputs/<file>.
"""

from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from services.detection import (
    get_model_status,
    load_model,
    run_detection,
    annotate_image,
    REQUIRED_MODEL_MESSAGE,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
UPLOAD_DIR = PROJECT_ROOT / "data" / "uploads"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}

APP_VERSION = "0.2.0"


# ---------------------------------------------------------------------------
# Lifespan — load the YOLO model safely when the backend starts.
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        status = load_model()
        print(f"[startup] model status: loaded={status['loaded']} "
              f"name={status['model_name']} type={status['model_type']}")
        if not status["loaded"]:
            print(f"[startup] WARNING: {status['error']}")
    except Exception as exc:  # never crash startup because of the model
        print(f"[startup] model load failed (non-fatal): {exc}")
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Urban Parcel Mapping API",
    description="Drone imagery -> YOLO building detection -> annotated outputs.",
    version=APP_VERSION,
    lifespan=lifespan,
)

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

# Serve annotated results: outputs/<file> -> GET /outputs/<file>
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _validate_extension(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )
    return suffix


async def _save_upload(file: UploadFile) -> tuple[Path, int, str]:
    suffix = _validate_extension(file.filename or "")
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    orig = Path(file.filename or f"upload{suffix}").name
    safe_name = f"{timestamp}_{orig}"
    dest = UPLOAD_DIR / safe_name
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file received.")
    dest.write_bytes(content)
    return dest, len(content), safe_name


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    return {
        "service": "Urban Parcel Mapping API",
        "version": APP_VERSION,
        "status": "running",
        "docs": "/docs",
        "health": "/api/health",
        "detect": "/detect/buildings",
        "model_status": "/detect/model-status",
    }


@app.get("/api/health")
def health():
    status = get_model_status()
    return {
        "status": "ok",
        "service": "urban-parcel-mapping-backend",
        "version": APP_VERSION,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "model_loaded": status["loaded"],
        "model_name": status["model_name"],
        "model_type": status["model_type"],
        "supports_buildings": status["supports_buildings"],
    }


@app.get("/api/info")
def info():
    status = get_model_status()
    return {
        "pipeline": [
            "1. Upload drone/aerial image",
            "2. AI analysis (YOLO building detection) — /detect/buildings",
            "3. Annotated image saved to outputs/ and served at /outputs/<file>",
            "4. Interactive map overlay — frontend shell ready",
            "5. Parcel/property report — upcoming",
        ],
        "stack": {
            "frontend": "React + Vite + Leaflet",
            "backend": "FastAPI",
            "ai": "Ultralytics YOLO (OpenCV annotation)",
        },
        "ai_status": "ready" if status["loaded"] else "model_missing",
        "model": status,
    }


@app.get("/detect/model-status")
@app.get("/api/detect/model-status")
def model_status():
    """Expose how the model was loaded (or why it is missing)."""
    return get_model_status()


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    """Accept an image and save it to data/uploads/ (legacy connectivity check)."""
    dest, size, safe_name = await _save_upload(file)
    _ = dest
    return JSONResponse(
        status_code=201,
        content={
            "message": "File received. Run POST /detect/buildings for AI analysis.",
            "filename": safe_name,
            "size_bytes": size,
        },
    )


async def _detect_buildings_impl(
    file: UploadFile,
    confidence: float,
    iou: float,
) -> dict:
    saved_path, size_bytes, saved_name = await _save_upload(file)

    # Model missing -> 503 with actionable instructions (never fake boxes).
    status = get_model_status()
    if not status["loaded"]:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Building-detection model is unavailable.",
                "help": status.get("error") or REQUIRED_MODEL_MESSAGE,
                "model_status": status,
            },
        )

    try:
        result = await run_in_threadpool(
            run_detection, saved_path, confidence, iou
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail={"message": "Detection failed.", "help": str(exc)},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")

    # Annotated image -> outputs/ (requirement) as browser-friendly JPEG.
    stem = Path(saved_name).stem
    annotated_name = f"{stem}_annotated.jpg"
    annotated_path = OUTPUTS_DIR / annotated_name
    try:
        await run_in_threadpool(
            annotate_image, saved_path, result["detections"], annotated_path
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Annotation failed: {exc}")

    return {
        "filename": saved_name,
        "size_bytes": size_bytes,
        "image_width": result["image_width"],
        "image_height": result["image_height"],
        "model": {
            "name": result["model_name"],
            "type": result["model_type"],
            "supports_buildings": result["supports_buildings"],
        },
        # Spec-shaped primary field: building-only boxes.
        "detections": result["detections"],
        # Transparency: every raw YOLO box with its real class name.
        "all_detections": result["all_detections"],
        "building_count": result["building_count"],
        "total_detections": result["total_detections"],
        "average_confidence": result["average_confidence"],
        "annotated_image": f"/outputs/{annotated_name}",
        "annotated_image_file": annotated_name,
        "warning": result["warning"],
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.post("/detect/buildings")
async def detect_buildings(
    file: UploadFile = File(...),
    confidence: float = Query(0.25, ge=0.01, le=0.99),
    iou: float = Query(0.45, ge=0.01, le=0.99),
):
    """Run YOLO building detection on an uploaded drone image.

    Returns:
        {
          "detections": [{"class": "building", "confidence": 0.92,
                          "bbox": [x1, y1, x2, y2], "class_id": 0}],
          "building_count": 3,
          "average_confidence": 0.87,
          "annotated_image": "/outputs/<file>_annotated.jpg",
          ...
        }
    """
    return await _detect_buildings_impl(file, confidence, iou)


# Alias under /api/* so the Vite dev proxy (`/api -> :8000`) works too.
@app.post("/api/detect/buildings")
async def detect_buildings_api_alias(
    file: UploadFile = File(...),
    confidence: float = Query(0.25, ge=0.01, le=0.99),
    iou: float = Query(0.45, ge=0.01, le=0.99),
):
    return await _detect_buildings_impl(file, confidence, iou)
