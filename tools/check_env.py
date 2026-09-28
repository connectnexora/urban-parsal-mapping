"""Environment preflight for the AI/ultralytics parts of this project.

Answers one question: why is YOLO not running, and what exactly do I have to
do about it? Safe to run any time; it only inspects, it never installs.

    python tools/check_env.py

Exit code 0 = at least the classical CV path is available.
Exit code 1 = a hard blocker was found (details are printed).
"""

from __future__ import annotations

import importlib.util
import os
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV_PY = ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
IS_WIN = os.name == "nt"

OK, WARN, BAD = "[ ok ]", "[warn]", "[FAIL]"


def _has(mod: str) -> bool:
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _try_import(mod: str):
    try:
        return importlib.import_module(mod), None
    except Exception as exc:  # noqa: BLE001 - we want the real reason
        return None, exc


def check_msvc_runtime() -> tuple[str, str]:
    """torch's DLLs need the Microsoft Visual C++ redistributable on Windows."""
    if not IS_WIN:
        return OK, "not Windows — no MSVC runtime check needed"
    if platform.system() != "Windows":
        return OK, "not Windows"
    system32 = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"
    missing = [d for d in ("msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll")
               if not (system32 / d).exists()]
    if not missing:
        return OK, "Visual C++ runtime present"
    return BAD, (
        f"missing {', '.join(missing)} — torch CANNOT load its DLLs. "
        "Install https://aka.ms/vs/17/release/vc_redist.x64.exe (run as admin) "
        "and restart the backend."
    )


def check_torch() -> tuple[str, str]:
    if not _has("torch"):
        return BAD, (
            "torch is not installed. CPU-only (recommended, ~120 MB):\n"
            "        pip install torch --index-url https://download.pytorch.org/whl/cpu\n"
            "    then: pip install -r backend/requirements.txt"
        )
    mod, exc = _try_import("torch")
    if mod is None:
        return BAD, f"torch is installed but fails to import: {exc}"
    return OK, f"torch {getattr(mod, '__version__', '?')}"


def check_ultralytics() -> tuple[str, str]:
    if not _has("ultralytics"):
        return BAD, "ultralytics not installed — pip install -r backend/requirements.txt"
    mod, exc = _try_import("ultralytics")
    if mod is None:
        return BAD, f"ultralytics is installed but fails to import: {exc}"
    return OK, f"ultralytics {getattr(mod, '__version__', '?')}"


def check_models() -> tuple[str, str]:
    d = ROOT / "models"
    weights = sorted(
        p for p in d.iterdir()
        if p.is_file() and p.suffix.lower() in {".pt", ".onnx", ".pth"}
    ) if d.is_dir() else []
    if not weights:
        return WARN, (
            f"{d} contains no weights. The backend will use the classical CV "
            "detectors. For real building detection add a building-trained "
            "weight (see models/README.md)."
        )
    return OK, f"{len(weights)} weight(s): {', '.join(p.name for p in weights[:6])}"


def check_cv_stack() -> tuple[str, str]:
    missing = [m for m in ("cv2", "numpy", "shapely", "PIL") if not _has(m)]
    if missing:
        return BAD, f"missing classical CV deps: {', '.join(missing)} — pip install -r backend/requirements.txt"
    return OK, "cv2, numpy, shapely, Pillow present (classical path available)"


def main() -> int:
    print(f"Urban Parcel Mapping — environment check\n{'-' * 60}")
    print(f"python  : {sys.version.split()[0]} ({sys.executable})")
    if VENV_PY.exists():
        print(f"venv    : {VENV_PY}")
    print()

    hard = 0
    for name, fn in (
        ("MSVC runtime", check_msvc_runtime),
        ("torch", check_torch),
        ("ultralytics", check_ultralytics),
        ("model weights", check_models),
        ("classical CV", check_cv_stack),
    ):
        tag, msg = fn()
        print(f"{name:15s} {tag} {msg}")
        if tag == BAD:
            hard += 1

    print()
    if hard:
        print("Real YOLO inference is NOT available yet. Follow the fixes above,")
        print("then restart the backend (uvicorn --reload picks it up) and re-run:")
        print("    python tools/check_env.py")
    else:
        print("Environment looks ready. GET /detect/model-status should report loaded=true.")
    return 1 if hard else 0


if __name__ == "__main__":
    raise SystemExit(main())
