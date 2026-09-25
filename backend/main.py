"""
AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction
FastAPI backend — buildings + approximate parcels + multi-class features.

- YOLO model loads SAFELY at startup (server never crashes on missing
  weights; YOLO-dependent results come back honest/empty with reasons).
- POST /upload: validate + save, return filename/dimensions/size/status.
- POST /detect/buildings: YOLO building-only detection + annotated image.
- POST /detect/parcels: preprocessing -> segmentation (YOLO-seg when
  available, else OpenCV watershed/contours) -> boundary extraction ->
  polygon generation -> simplification -> area/perimeter estimates.
  Parcels are ALWAYS labelled AI-estimated/approximate, never legal cadastre.
- POST /detect/features: full pipeline -> features{buildings, roads,
  vegetation, water, other} with class/confidence/geometry per feature,
  plus an annotated image under outputs/ served at /outputs/<file>.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

try:
    from services.detection import (
        get_model_status,
        load_model,
        run_detection,
        annotate_image,
        REQUIRED_MODEL_MESSAGE,
    )
    from services.parcels import (
        get_parcel_status,
        init_parcel_service,
        extract_parcels,
        annotate_parcels,
        APPROX_DISCLAIMER,
    )
    from services.features import (
        extract_features,
        annotate_features,
        FEATURE_TYPES,
        FEATURE_COLORS_HEX,
    )
except ImportError:  # allow `uvicorn backend.main:app` from the project root
    from backend.services.detection import (
        get_model_status,
        load_model,
        run_detection,
        annotate_image,
        REQUIRED_MODEL_MESSAGE,
    )
    from backend.services.parcels import (
        get_parcel_status,
        init_parcel_service,
        extract_parcels,
        annotate_parcels,
        APPROX_DISCLAIMER,
    )
    from backend.services.features import (
        extract_features,
        annotate_features,
        FEATURE_TYPES,
        FEATURE_COLORS_HEX,
    )

from PIL import Image, UnidentifiedImageError

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

# Prototype cap — drone frames are big, but bound memory per request.
MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB

APP_VERSION = "0.4.0"


# ---------------------------------------------------------------------------
# Lifespan — load AI models safely when the backend starts.
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        status = load_model()
        print(f"[startup] yolo status: loaded={status['loaded']} "
              f"name={status['model_name']} type={status['model_type']}")
        if not status["loaded"]:
            print(f"[startup] WARNING: {status['error']}")
    except Exception as exc:  # never crash startup because of the model
        print(f"[startup] yolo load failed (non-fatal): {exc}")
    try:
        pstatus = init_parcel_service()
        print(f"[startup] parcel status: ready={pstatus['ready']} "
              f"yolo_seg={pstatus.get('yolo_seg_available')}")
        if pstatus.get("error"):
            print(f"[startup] WARNING: {pstatus['error']}")
    except Exception as exc:
        print(f"[startup] parcel init failed (non-fatal): {exc}")
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Urban Parcel Mapping API",
    description="Drone imagery -> YOLO buildings + approximate parcels + multi-class features.",
    version=APP_VERSION,
    lifespan=lifespan,
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

# Serve annotated results: outputs/<file> -> GET /outputs/<file>
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")


# ---------------------------------------------------------------------------
# Upload helpers (hardened: traversal-safe names, size cap, image validation)
# ---------------------------------------------------------------------------
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


def _validate_extension(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix or '(none)'}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )
    return suffix


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
    _validate_extension(original)

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
        "path": str(dest),
        "original_filename": original,
        "width": width,
        "height": height,
        "size_bytes": len(content),
        "status": "uploaded",
    }


def _public_upload_meta(stored: dict) -> dict:
    return {k: stored[k] for k in ("filename", "original_filename", "width", "height", "size_bytes", "status")}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    """Root endpoint — quick human-readable check."""
    return {
        "service": "Urban Parcel Mapping API",
        "version": APP_VERSION,
        "status": "running",
        "docs": "/docs",
        "health": "/api/health",
        "detect_buildings": "/detect/buildings",
        "detect_parcels": "/detect/parcels",
        "detect_features": "/detect/features",
        "model_status": "/detect/model-status",
        "parcel_status": "/detect/parcel-status",
        "disclaimer": APPROX_DISCLAIMER,
    }


@app.get("/api/health")
def health():
    """Health check used by the frontend 'Test Connection' button."""
    status = get_model_status()
    pstatus = get_parcel_status()
    return {
        "status": "ok",
        "service": "urban-parcel-mapping-backend",
        "version": APP_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_loaded": status["loaded"],
        "model_name": status["model_name"],
        "model_type": status["model_type"],
        "supports_buildings": status["supports_buildings"],
        "parcel_ready": pstatus.get("ready", False),
        "parcel_method_hint": "yolo-seg" if pstatus.get("yolo_seg_available") else "classical-watershed-contours",
    }


@app.get("/api/info")
def info():
    """Describe the pipeline (no AI execution here)."""
    status = get_model_status()
    pstatus = get_parcel_status()
    return {
        "pipeline": [
            "1. Upload drone/aerial image",
            "2a. Building detection (YOLO) — /detect/buildings",
            "2b. Approximate parcel polygons — /detect/parcels "
            "(preprocessing -> segmentation -> boundaries -> polygons -> "
            "simplification -> area; NOT legal cadastre)",
            "2c. Full feature pipeline — /detect/features "
            "(buildings/roads/vegetation/water/other)",
            "3. Annotated images + GeoJSON saved to outputs/, served at /outputs/<file>",
            "4. Interactive map overlays per feature/parcel type — frontend layers",
        ],
        "stack": {
            "frontend": "React + Vite + Leaflet",
            "backend": "FastAPI",
            "ai": "Ultralytics YOLO (+YOLO-seg when available) + classical colour/watershed segmentation",
        },
        "feature_types": list(FEATURE_TYPES),
        "ai_status": "ready" if status["loaded"] else "model_missing",
        "model": status,
        "parcels": pstatus,
        "disclaimer": APPROX_DISCLAIMER,
    }


@app.get("/detect/model-status")
@app.get("/api/detect/model-status")
def model_status():
    """Expose how the YOLO model was loaded (or why it is missing)."""
    return get_model_status()


@app.get("/detect/parcel-status")
@app.get("/api/detect/parcel-status")
def parcel_status():
    """Expose parcel segmentation readiness + available weights."""
    return get_parcel_status()


@app.post("/upload", status_code=201)
async def upload(file: UploadFile = File(...)):
    """
    Receive a drone image, validate it, save it to data/uploads/,
    and return filename, image dimensions, file size and upload status.
    No AI detection runs on this endpoint.
    """
    stored = await _store_upload(file)
    return _public_upload_meta(stored)


@app.post("/api/upload", status_code=201)
async def upload_image(file: UploadFile = File(...)):
    """
    Same storage + validation as POST /upload; kept for the Vite dev
    proxy and the existing UI. Deliberately returns NO detections.
    """
    stored = await _store_upload(file)
    return JSONResponse(
        status_code=201,
        content={
            **_public_upload_meta(stored),
            "message": "File received. Run POST /detect/buildings, /detect/parcels or /detect/features for AI analysis.",
            "detections": None,  # explicitly null — no fake results
        },
    )


async def _detect_buildings_impl(
    file: UploadFile,
    confidence: float,
    iou: float,
) -> dict:
    stored = await _store_upload(file)
    saved_path = Path(stored["path"])
    saved_name = stored["filename"]
    size_bytes = stored["size_bytes"]

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
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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
        "timestamp": datetime.now(timezone.utc).isoformat(),
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


async def _detect_parcels_impl(
    file: UploadFile,
    gsd: float,
    epsilon: float,
    conf: float,
    max_parcels: int,
) -> dict:
    stored = await _store_upload(file)
    saved_path = Path(stored["path"])
    saved_name = stored["filename"]

    pstatus = get_parcel_status()
    if not pstatus.get("ready"):
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Parcel extraction is unavailable.",
                "help": pstatus.get("error") or pstatus.get("help"),
                "parcel_status": pstatus,
            },
        )

    try:
        result = await run_in_threadpool(
            extract_parcels,
            saved_path,
            gsd,
            800.0,  # min_area_px baseline (adaptive inside)
            epsilon,
            conf,
            1600,  # max_dim preprocessing cap
            max_parcels,
        )
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail={"message": "Parcel extraction failed.", "help": str(exc)},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Parcel inference failed: {exc}")

    stem = Path(saved_name).stem
    annotated_name = f"{stem}_parcels.jpg"
    geojson_name = f"{stem}_parcels.geojson"
    annotated_path = OUTPUTS_DIR / annotated_name
    geojson_path = OUTPUTS_DIR / geojson_name
    try:
        await run_in_threadpool(annotate_parcels, saved_path, result["parcels"], annotated_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Parcel annotation failed: {exc}")
    try:
        geojson_path.write_text(json.dumps(result["geojson"], indent=2), encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write GeoJSON: {exc}")

    return {
        "filename": saved_name,
        "size_bytes": stored["size_bytes"],
        "image_width": result["image_width"],
        "image_height": result["image_height"],
        "gsd_m_per_px": result["gsd_m_per_px"],
        "method": result["method"],
        "used_seg_model": result["used_seg_model"],
        "parcels": result["parcels"],
        "parcel_count": result["parcel_count"],
        "total_area_estimated_m2": result["total_area_estimated_m2"],
        "average_confidence": result["average_confidence"],
        "geojson": result["geojson"],
        "annotated_image": f"/outputs/{annotated_name}",
        "annotated_image_file": annotated_name,
        "geojson_file": f"/outputs/{geojson_name}",
        "geojson_filename": geojson_name,
        "disclaimer": result["disclaimer"],
        "notes": result["notes"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/detect/parcels")
async def detect_parcels(
    file: UploadFile = File(...),
    gsd: float = Query(
        0.1, ge=0.001, le=10.0,
        description="Ground sample distance in meters/pixel. Areas are estimates.",
    ),
    epsilon: float = Query(
        0.012, ge=0.002, le=0.08,
        description="Polygon simplification factor (fraction of perimeter).",
    ),
    conf: float = Query(0.25, ge=0.01, le=0.99,
                        description="Confidence threshold for YOLO-seg masks when available."),
    max_parcels: int = Query(60, ge=1, le=200),
):
    """Extract approximate parcel polygons from a drone image.

    Returns parcels as [{parcel_id, area, perimeter, confidence, polygon}],
    where area/perimeter are AI-estimated via GSD — NOT legal cadastre —
    plus an annotated image and GeoJSON, both saved under outputs/.
    """
    return await _detect_parcels_impl(file, gsd, epsilon, conf, max_parcels)


@app.post("/api/detect/parcels")
async def detect_parcels_api_alias(
    file: UploadFile = File(...),
    gsd: float = Query(0.1, ge=0.001, le=10.0),
    epsilon: float = Query(0.012, ge=0.002, le=0.08),
    conf: float = Query(0.25, ge=0.01, le=0.99),
    max_parcels: int = Query(60, ge=1, le=200),
):
    """Vite-proxy alias for POST /detect/parcels."""
    return await _detect_parcels_impl(file, gsd, epsilon, conf, max_parcels)


async def _detect_features_impl(
    file: UploadFile,
    confidence: float,
    iou: float,
) -> dict:
    """Full feature-extraction pipeline (never invents detections)."""
    stored = await _store_upload(file)
    saved_path = Path(stored["path"])
    saved_name = stored["filename"]

    status = get_model_status()
    yolo_dets: list = []
    warnings: list = []
    if status["loaded"]:
        try:
            result = await run_in_threadpool(run_detection, saved_path, confidence, iou)
            yolo_dets = result["all_detections"]
            if result.get("warning"):
                warnings.append(result["warning"])
        except Exception as exc:
            # Honest degradation: YOLO failed, classical branch still runs.
            warnings.append(f"YOLO inference failed ({exc}); YOLO-based categories are empty.")
            status = {**status, "loaded": False}
    else:
        warnings.append(
            "YOLO model unavailable — buildings/roads/other come only from a loaded model "
            "and are empty in this response. Vegetation/water use classical segmentation."
        )

    pipe = await run_in_threadpool(
        extract_features, saved_path, yolo_dets, status["loaded"]
    )
    features = pipe["features"]
    counts = {k: len(v) for k, v in features.items()}
    counts["total"] = sum(counts.values())

    stem = Path(saved_name).stem
    annotated_name = f"{stem}_features.jpg"
    annotated_path = OUTPUTS_DIR / annotated_name
    try:
        await run_in_threadpool(annotate_features, saved_path, features, annotated_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Annotation failed: {exc}")

    buildings = features["buildings"]
    avg_conf = round(sum(d["confidence"] for d in buildings) / len(buildings), 4) if buildings else 0.0

    return {
        "filename": saved_name,
        "size_bytes": stored["size_bytes"],
        "image_width": stored["width"],
        "image_height": stored["height"],
        "model": {
            "name": status["model_name"],
            "type": status["model_type"],
            "supports_buildings": status["supports_buildings"],
            "loaded": status["loaded"],
        },
        # Required shape: detections organised by feature type.
        "features": features,
        "counts": counts,
        # Why an empty category is empty (model missing vs nothing found).
        "reasons": pipe["reasons"],
        "feature_colors": FEATURE_COLORS_HEX,
        # Backwards-compatible building summary (mirrors /detect/buildings).
        "detections": buildings,
        "building_count": len(buildings),
        "average_confidence": avg_conf,
        "annotated_image": f"/outputs/{annotated_name}",
        "annotated_image_file": annotated_name,
        "segmentation_stats": pipe.get("segmentation_stats", {}),
        "warnings": warnings,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/detect/features")
async def detect_features(
    file: UploadFile = File(...),
    confidence: float = Query(0.25, ge=0.01, le=0.99),
    iou: float = Query(0.45, ge=0.01, le=0.99),
):
    """Run the full feature-extraction pipeline on an uploaded drone image.

    Returns:
        {
          "features": {
            "buildings": [{"class", "confidence", "bbox", "polygon", ...}],
            "roads": [...],
            "vegetation": [...],
            "water": [...],
            "other": [...]
          },
          "counts": {...}, "reasons": {...},
          "annotated_image": "/outputs/<file>_features.jpg", ...
        }

    Empty categories are honest (see `reasons`) — never fabricated.
    """
    return await _detect_features_impl(file, confidence, iou)


# Alias under /api/* so the Vite dev proxy (`/api -> :8000`) works too.
@app.post("/api/detect/features")
async def detect_features_api_alias(
    file: UploadFile = File(...),
    confidence: float = Query(0.25, ge=0.01, le=0.99),
    iou: float = Query(0.45, ge=0.01, le=0.99),
):
    return await _detect_features_impl(file, confidence, iou)
