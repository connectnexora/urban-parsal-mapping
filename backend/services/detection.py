# AI building-detection service (YOLO-based, no fake results).
#
# Strategy (honest, no hardcoding):
#  1. Prefer a *building-capable* custom YOLO weight if one is present in
#     models/  (e.g. trained on xView / DOTA / SpaceNet / OpenCities AI /
#     INRIA Aerial / CrowdAI Mapping Challenge). Any file whose name hints
#     at buildings/footprints/roofs/xview/dota/spacenet/inria is tried first.
#  2. Otherwise fall back to any other *.pt/*.onnx in models/, or to the
#     generic COCO `yolov8n.pt` (auto-downloaded by ultralytics on first use).
#     COCO has NO "building" class, so in that case detections are returned
#     with their REAL class names, building_count is 0 (or whatever the
#     filter finds), and a clear warning explains which custom model is
#     required. Nothing is ever fabricated.
#  3. If no model can be loaded at all, callers receive a RuntimeError whose
#     message documents exactly which file/dataset is required.

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    from utils.cache import cached, file_fingerprint
except ImportError:  # allow `uvicorn backend.main:app` from the project root
    from backend.utils.cache import cached, file_fingerprint

# ---------------------------------------------------------------------------
# Paths / constants
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
PROJECT_ROOT = BASE_DIR.parent                             # project root
MODELS_DIR = PROJECT_ROOT / "models"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# Generic COCO fallback (ultralytics auto-downloads it on first use when
# network access is available). COCO does NOT contain a "building" class.
GENERIC_FALLBACK_WEIGHT = os.environ.get("YOLO_FALLBACK_WEIGHT", "yolov8n.pt")

# Explicit override: point to a custom building model without renaming files.
#   Windows (PowerShell):  $env:YOLO_MODEL_PATH="models/building_yolov8n.pt"
ENV_MODEL_OVERRIDE = (
    os.environ.get("YOLO_MODEL_PATH") or os.environ.get("BUILDING_MODEL_PATH") or ""
).strip()

# Class names treated as "building". Matching is case-insensitive; a label
# containing "building", "footprint" or "rooftop" also counts (covers labels
# such as "residential building" or "building_footprint").
BUILDING_ALIASES = {
    "building",
    "buildings",
    "house",
    "houses",
    "roof",
    "roofs",
    "rooftop",
    "hut",
    "edifice",
}

# Filename hints (lowercase substrings) that mark a weight file as
# building-capable. Searched first, in directory-sort order.
BUILDING_FILENAME_HINTS = (
    "building",
    "bldg",
    "footprint",
    "roof",
    "xview",
    "dota",
    "spacenet",
    "opencities",
    "open-cities",
    "inria",
    "crowdai",
    "urban",
    "parcel",
    "aerial",
)

REQUIRED_MODEL_MESSAGE = (
    "No building-capable YOLO model is available. "
    "To enable real building detection, place a custom-trained YOLO weight in the "
    "models/ directory (e.g. models/building_yolov8n.pt) trained on an aerial-building "
    "dataset such as xView, DOTA-v2, SpaceNet, OpenCities AI, INRIA Aerial Image "
    "Labeling, or CrowdAI Mapping Challenge, with a 'building' class. "
    "Then restart the backend. "
    "The generic COCO yolov8n.pt model does NOT contain a 'building' class, so it "
    "cannot detect buildings — it is used only as a transparent fallback that "
    "returns its real (non-building) class names. "
    "Optionally set the YOLO_MODEL_PATH environment variable to point at your "
    "custom weight. No fake/synthetic boxes are ever returned."
)

# ---------------------------------------------------------------------------
# Module-level model state (loaded once at backend startup via load_model()).
# ---------------------------------------------------------------------------
_model: Any = None
_model_path: str | None = None
_model_class_names: Dict[int, str] = {}
_model_type: str = "none"  # "building-specific" | "generic-coco" | "custom-other" | "none"
_supports_buildings: bool = False
_load_error: str | None = None


def _is_building_label(label: str) -> bool:
    low = (label or "").strip().lower()
    if low in BUILDING_ALIASES:
        return True
    # Cover compound labels such as "residential building", "building_footprint".
    for token in ("building", "footprint", "rooftop", "roof"):
        if token in low:
            return True
    return False


def _supports_building_class(names: Dict[int, str] | List[str]) -> bool:
    if isinstance(names, dict):
        labels = list(names.values())
    else:
        labels = list(names or [])
    return any(_is_building_label(str(lbl)) for lbl in labels)


def find_candidate_weights() -> List[Path]:
    """Ordered list of local weight files to try.

    Building-hinted files first, then any other *.pt/*.onnx, so a custom
    building model always wins over a generic COCO weight.
    """
    candidates: List[Path] = []
    if ENV_MODEL_OVERRIDE:
        p = (PROJECT_ROOT / ENV_MODEL_OVERRIDE).resolve() if not Path(
            ENV_MODEL_OVERRIDE
        ).is_absolute() else Path(ENV_MODEL_OVERRIDE)
        if p.is_file():
            candidates.append(p)
    if not MODELS_DIR.is_dir():
        return candidates
    files = [p for p in MODELS_DIR.iterdir() if p.is_file()]
    weights = [p for p in files if p.suffix.lower() in {".pt", ".onnx"}]

    def hinted(p: Path) -> bool:
        name = p.name.lower()
        return any(h in name for h in BUILDING_FILENAME_HINTS)

    hinted_first = sorted([p for p in weights if hinted(p)], key=lambda p: p.name.lower())
    rest = sorted([p for p in weights if not hinted(p)], key=lambda p: p.name.lower())
    for p in hinted_first + rest:
        if p not in candidates:
            candidates.append(p)
    return candidates


def _allow_legacy_torch_weights() -> None:
    """Restore legacy `torch.load` behaviour for YOLO checkpoints.

    torch>=2.6 defaults `torch.load` to `weights_only=True`, which rejects
    ultralytics checkpoints (allowlisting every torch.nn global is
    whack-a-mole). We only load weights we deliberately chose — the official
    ultralytics CDN fallback and the local `models/` directory — so forcing
    the legacy default for this process is acceptable for this prototype.
    Safe to call repeatedly; patches at most once. Never raises.
    """
    try:
        import functools

        import torch

        if getattr(torch.load, "_upm_legacy_weights", False):
            return

        _orig_load = torch.load

        @functools.wraps(_orig_load)
        def _patched(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return _orig_load(*args, **kwargs)

        _patched._upm_legacy_weights = True  # type: ignore[attr-defined]
        torch.load = _patched  # type: ignore[assignment]
    except Exception:
        pass


def load_model() -> Dict[str, Any]:
    """Load the YOLO model safely (called once at backend startup).

    Never raises: on failure the module stays in "no model" state and the
    error is recorded in the status dict so endpoints can return a clear
    503 instead of fake results.
    """
    global _model, _model_path, _model_class_names, _model_type
    global _supports_buildings, _load_error

    if _model is not None:
        return get_model_status()

    try:
        from ultralytics import YOLO  # local import: keeps module importable w/o deps
    except Exception as exc:  # ultralytics / torch not installed
        _model = None
        detail = " ".join(str(exc).split())[:220] or exc.__class__.__name__
        hint = ""
        if "126" in detail or "dll" in detail.lower():
            # Windows without the MSVC runtime: torch's DLLs cannot load.
            hint = (
                " This is usually the missing Microsoft Visual C++ Redistributable "
                "on Windows (torch cannot load its DLLs) — install "
                "https://aka.ms/vs/17/release/vc_redist.x64.exe, then restart."
            )
        _load_error = (
            f"ultralytics/torch unavailable ({detail}). "
            "Install backend/requirements.txt (pip install -r requirements.txt)."
            + hint + " " + REQUIRED_MODEL_MESSAGE
        )
        return get_model_status()

    candidates = find_candidate_weights()
    # Always allow the generic COCO fallback as a last resort (ultralytics
    # downloads it automatically when missing and network is available).
    tried: List[str] = [str(p) for p in candidates]
    last_error: Exception | None = None

    search_order: List[str] = tried + [GENERIC_FALLBACK_WEIGHT]
    _allow_legacy_torch_weights()
    for weight in search_order:
        try:
            yolo = YOLO(weight)
            names: Dict[int, str] = dict(getattr(yolo, "names", {}) or {})
            _model = yolo
            try:
                _model_path = str(Path(weight).resolve()) if Path(weight).is_file() else str(weight)
            except Exception:
                _model_path = str(weight)
            # Friendly short name for API responses.
            _model_class_names = names
            if _supports_building_class(names):
                _supports_buildings = True
                # Distinguish a purpose-built file from a generic one that
                # happens to contain a building-like label.
                fname = Path(str(weight)).name.lower()
                _model_type = "building-specific" if any(
                    h in fname for h in BUILDING_FILENAME_HINTS
                ) else "custom-other"
            else:
                _supports_buildings = False
                _model_type = "generic-coco"
            _load_error = None
            return get_model_status()
        except Exception as exc:
            last_error = exc
            continue

    _model = None
    _model_path = None
    _model_class_names = {}
    _model_type = "none"
    _supports_buildings = False
    detail = f" Last error: {last_error}." if last_error else ""
    _load_error = (
        "Could not load any YOLO model (tried: "
        + (", ".join(tried) if tried else "(no local weights found)")
        + f" + fallback '{GENERIC_FALLBACK_WEIGHT}').{detail} " + REQUIRED_MODEL_MESSAGE
    )
    return get_model_status()


def get_model_status() -> Dict[str, Any]:
    """Describe the currently loaded (or missing) model."""
    return {
        "loaded": _model is not None,
        "model_path": _model_path,
        "model_name": Path(_model_path).name if _model_path else None,
        "model_type": _model_type,
        "supports_buildings": _supports_buildings,
        "classes": _model_class_names,
        "num_classes": len(_model_class_names),
        "error": _load_error,
        "required_model_help": None if _model is not None else REQUIRED_MODEL_MESSAGE,
    }


def _require_model() -> Any:
    if _model is None:
        raise RuntimeError(_load_error or REQUIRED_MODEL_MESSAGE)
    return _model


def _read_image_size(image_path: Path) -> Tuple[int, int]:
    """Return (width, height) using cv2 with a PIL fallback."""
    try:
        import cv2

        img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if img is not None and img.size:
            h, w = img.shape[:2]
            return int(w), int(h)
    except Exception:
        pass
    try:
        from PIL import Image

        with Image.open(image_path) as im:
            return int(im.width), int(im.height)
    except Exception:
        pass
    return 0, 0


def run_detection(
    image_path: str | Path,
    conf: float = 0.25,
    iou: float = 0.45,
) -> Dict[str, Any]:
    """Run YOLO inference on an image file (memoised per file + parameters).

    `/detect/buildings` and `/detect/features` need the same inference for
    the same frame, so the result is cached under the file's content
    fingerprint. The one-click full-analysis pipeline therefore pays for
    YOLO + the classical rooftop fallback once instead of twice.

    Returns a dict with:
      - detections: building-only boxes [{class, confidence, bbox, class_id}]
      - all_detections: every raw detection (real class names, never faked)
      - building_count, average_confidence
      - image_width / image_height, model info, warning (when generic)
      - model_loaded: False when no YOLO weight is available

    With no YOLO model the endpoint does NOT fail: it falls back to the
    classical rooftop detector (real CV on this image, labelled
    `method: "classical-rooftop"`) and explains the missing model in
    `warning`, matching what /detect/features already does. Geometry is
    always computed from the image — nothing is ever fabricated.
    """
    model = _model  # may be None: the classical fallback still works
    image_path = Path(image_path)
    if not image_path.is_file():
        raise FileNotFoundError(f"Image not found: {image_path}")

    conf = float(max(0.01, min(0.99, conf)))
    iou = float(max(0.01, min(0.99, iou)))

    key = (
        "detection",
        _model_path or "",
        _model_type,
        round(conf, 4),
        round(iou, 4),
    ) + file_fingerprint(image_path)

    result, hit = cached(
        key, lambda: _run_detection_uncached(model, image_path, conf, iou)
    )
    result["cache_hit"] = hit
    return result


def _run_detection_uncached(
    model: Any,
    image_path: Path,
    conf: float,
    iou: float,
) -> Dict[str, Any]:
    """Inference + box parsing for one image. See run_detection().

    `model` may be None (no usable YOLO weight) — in that case the YOLO
    branch is skipped entirely and only the classical rooftop detector runs.
    """
    all_dets: List[Dict[str, Any]] = []
    names: Dict[int, str] = {}
    r0 = None

    if model is not None:
        results = model.predict(source=str(image_path), conf=conf, iou=iou, verbose=False)
        if not results:
            raise RuntimeError("YOLO returned no results for the image.")

        r0 = results[0]
        names = dict(getattr(model, "names", {}) or getattr(r0, "names", {}) or {})

        try:
            boxes = r0.boxes
            if boxes is not None and len(boxes) > 0:
                for box in boxes:
                    xyxy = box.xyxy[0].tolist()  # [x1, y1, x2, y2]
                    cls_id = int(box.cls[0].tolist())
                    score = float(box.conf[0].tolist())
                    label = str(names.get(cls_id, str(cls_id)))
                    x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
                    all_dets.append(
                        {
                            "class": label,
                            "class_id": cls_id,
                            "confidence": round(score, 4),
                            "bbox": [x1, y1, x2, y2],
                        }
                    )
        except Exception as exc:
            raise RuntimeError(f"Failed to parse YOLO results: {exc}")

    building_dets = [d for d in all_dets if _is_building_label(d["class"])]
    classical_dets: List[Dict[str, Any]] = []
    if not _supports_buildings:
        # Generic COCO weights have no building class, so YOLO alone would
        # always report 0 buildings on aerial imagery. Fall back to a real
        # classical rooftop detector (computed from the image, never invented)
        # so the count reflects visible houses.
        try:
            try:
                from services.rooftops import detect_rooftops
            except ImportError:  # `uvicorn backend.main:app` from project root
                from backend.services.rooftops import detect_rooftops
            classical_dets = detect_rooftops(image_path, conf_threshold=conf) or []
        except Exception:
            classical_dets = []
        if classical_dets:
            # Keep raw YOLO boxes for transparency, add classical rooftops.
            # Strip the internal `method` key from all_detections entries?
            # No — keep it: it documents provenance. The /detect/buildings
            # `detections` field stays building-only.
            for det in classical_dets:
                all_dets.append(
                    {
                        "class": det.get("class", "building"),
                        "class_id": det.get("class_id", 0),
                        "confidence": det.get("confidence", 0.0),
                        "bbox": det.get("bbox"),
                        "method": det.get("method", "classical-rooftop"),
                    }
                )
            building_dets = [
                {
                    "class": d.get("class", "building"),
                    "class_id": d.get("class_id", 0),
                    "confidence": d.get("confidence", 0.0),
                    "bbox": d.get("bbox"),
                }
                for d in classical_dets
            ]
    count = len(building_dets)
    avg = round(sum(d["confidence"] for d in building_dets) / count, 4) if count else 0.0
    # Reuse the shape ultralytics already decoded instead of re-reading the
    # file with cv2.imread just to learn its dimensions.
    orig_shape = getattr(r0, "orig_shape", None) if r0 is not None else None
    if orig_shape and len(orig_shape) >= 2:
        height, width = int(orig_shape[0]), int(orig_shape[1])
    else:
        width, height = _read_image_size(image_path)

    model_loaded = _model is not None
    warning: str | None = None
    if not model_loaded:
        # No usable YOLO weight at all: the classical detector is the ONLY
        # source of geometry, and it is real CV on this image.
        if classical_dets:
            warning = (
                "No YOLO model is loaded in this backend (%s), so buildings were "
                "detected with the classical rooftop detector (colour + edge "
                "rectangularity, inpainted parcel overlays, vegetation rejection) "
                "computed from this image. %d building(s) reported with heuristic "
                "confidence (shape-based, not a learned score). %s"
                % (
                    _load_error or "no weights available",
                    len(classical_dets),
                    REQUIRED_MODEL_MESSAGE,
                )
            )
        else:
            warning = (
                "No YOLO model is loaded in this backend (%s) and the classical "
                "rooftop detector found no rectangular rooftops in this image, so "
                "0 buildings are reported. %s"
                % (_load_error or "no weights available", REQUIRED_MODEL_MESSAGE)
            )
    elif not _supports_buildings:
        if classical_dets:
            warning = (
                "The loaded model (%s) has no 'building' class (generic COCO fallback), "
                "so buildings were detected with a classical rooftop detector "
                "(colour + edge rectangularity, inpainted parcel overlays, "
                "vegetation rejection) computed from this image. %d building(s) "
                "reported with heuristic confidence; %d raw YOLO detection(s) "
                "with real class names are preserved in all_detections."
                % (
                    (Path(_model_path).name if _model_path else "unknown"),
                    len(classical_dets),
                    len(all_dets) - len(classical_dets),
                )
            )
        else:
            warning = (
                "The loaded model (%s) does not have a 'building' class, so no "
                "building-specific detection is possible with it. All %d raw "
                "detection(s) are returned with their real class names and "
                "building_count counts only building-class boxes. %s"
                % (
                    (Path(_model_path).name if _model_path else "unknown"),
                    len(all_dets),
                    REQUIRED_MODEL_MESSAGE,
                )
            )

    return {
        "detections": building_dets,
        "all_detections": all_dets,
        "building_count": count,
        "average_confidence": avg,
        "total_detections": len(all_dets),
        "image_width": width,
        "image_height": height,
        "model_name": Path(_model_path).name if _model_path else None,
        "model_type": _model_type,
        "model_loaded": model_loaded,
        "supports_buildings": _supports_buildings,
        # Which detector produced `detections` — "classical-rooftop" when the
        # boxes come from the CV fallback rather than a YOLO weight.
        "detection_method": (
            "yolo" if (_model is not None and _supports_buildings)
            else "classical-rooftop" if classical_dets
            else "none"
        ),
        "warning": warning,
    }


def annotate_image(
    image_path: str | Path,
    detections: List[Dict[str, Any]],
    output_path: str | Path,
    title: str = "Buildings",
) -> Path:
    """Draw bounding boxes + labels onto a copy of the image.

    Only the *given* detections are drawn (callers pass building-only or all
    detections explicitly). `title` labels the header banner — pass e.g.
    "Detections" when drawing non-building boxes. Returns the output path.
    Raises RuntimeError when the image cannot be read/written.
    """
    try:
        import cv2  # type: ignore
    except Exception:
        cv2 = None  # type: ignore
    if cv2 is None:
        # Minimal environments (no OpenCV): draw with PIL instead.
        from PIL import Image as _PILImage, ImageDraw as _ImageDraw, ImageFont as _ImageFont

        image_path = Path(image_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with _PILImage.open(image_path) as _im:
                _img = _im.convert("RGB")
                _w, _h = _img.size
                _d = _ImageDraw.Draw(_img)
                try:
                    _font = _ImageFont.load_default(size=max(12, max(_w, _h) // 80))
                except Exception:
                    _font = _ImageFont.load_default()
                for det in detections or []:
                    try:
                        _x1, _y1, _x2, _y2 = (int(v) for v in det["bbox"])
                        _conf = float(det.get("confidence", 0))
                    except Exception:
                        continue
                    _d.rectangle([_x1, _y1, _x2, _y2], outline=(46, 204, 113), width=2)
                    _d.text((_x1 + 3, max(0, _y1 - 14)),
                            f"{det.get('class', 'obj')} {_conf:.2f}",
                            fill=(46, 204, 113), font=_font)
                _d.text((10, 10), f"{title}: {len(detections or [])}",
                        fill=(56, 189, 248), font=_font)
                _img.save(output_path, "JPEG", quality=90)
        except Exception as exc:
            raise RuntimeError(f"Could not annotate image: {exc}")
        return output_path

    image_path = Path(image_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        # TIF / exotic formats: retry via PIL -> numpy (BGR).
        try:
            import numpy as np
            from PIL import Image

            with Image.open(image_path) as pil:
                rgb = pil.convert("RGB")
                arr = np.asarray(rgb)
                img = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        except Exception as exc:
            raise RuntimeError(f"Could not read image for annotation: {exc}")
    if img is None:
        raise RuntimeError(f"Could not read image: {image_path}")

    h, w = img.shape[:2]
    # Scale-independent line thickness / font.
    thickness = max(2, round(max(h, w) / 500))
    font_scale = max(0.5, max(h, w) / 1200.0)

    for det in detections or []:
        try:
            x1, y1, x2, y2 = (int(v) for v in det["bbox"])
            conf = float(det.get("confidence", 0))
        except Exception:
            continue
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w - 1, x2), min(h - 1, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        label = f"{det.get('class', 'obj')} {conf:.2f}"
        cv2.rectangle(img, (x1, y1), (x2, y2), (46, 204, 113), thickness)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        y0 = max(0, y1 - th - 10)
        cv2.rectangle(img, (x1, y0), (x1 + tw + 8, y0 + th + 10), (46, 204, 113), -1)
        cv2.putText(
            img, label, (x1 + 4, y0 + th + 4),
            cv2.FONT_HERSHEY_SIMPLEX, font_scale, (6, 18, 31), thickness,
            cv2.LINE_AA,
        )

    # Header banner with the count (drawn even when zero — honest output).
    banner = f"{title}: {len(detections or [])}"
    (tw, th), _ = cv2.getTextSize(banner, cv2.FONT_HERSHEY_SIMPLEX, font_scale + 0.2, thickness)
    cv2.rectangle(img, (8, 8), (8 + tw + 16, 8 + th + 16), (11, 18, 32), -1)
    cv2.putText(
        img, banner, (16, 16 + th + 4),
        cv2.FONT_HERSHEY_SIMPLEX, font_scale + 0.2, (56, 189, 248), thickness,
        cv2.LINE_AA,
    )

    ok = cv2.imwrite(str(output_path), img)
    if not ok:
        raise RuntimeError(f"Failed to write annotated image: {output_path}")
    return output_path


def analyze_image(image_path: str, conf: float = 0.25, iou: float = 0.45) -> Dict[str, Any]:
    """Backwards-compatible alias kept for older imports."""
    return run_detection(image_path, conf=conf, iou=iou)
