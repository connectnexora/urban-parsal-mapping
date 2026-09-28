"""Dataset validation + training for a real building/road detector.

This exists because the honest answer to "why are the detections wrong?" is
usually "there is no model" — and a model needs LABELS. This script makes
that path concrete and repeatable instead of hand-wavy.

    python tools/train_detector.py check     # validate dataset + environment
    python tools/train_detector.py scaffold  # create the expected layout
    python tools/train_detector.py train     # fine-tune (needs torch working)

Dataset layout (Ultralytics YOLO format):

    data/dataset/
      data.yaml
      images/train/*.jpg  images/val/*.jpg
      labels/train/*.txt  labels/val/*.txt     # "cls cx cy w h" normalised

Aerial defaults differ sharply from the COCO defaults: small objects in large
scenes need a bigger --imgsz, and low object density needs more epochs.

WHERE TO GET LABELS (free, public, building footprints already annotated):
  * SpaceNet 2 — building footprints (30 cities), AWS Open Data
  * Inria Aerial Image Labeling — building masks, 5 cities
  * xView / OpenCities AI (DigitalGlobe) — rare-class building chips
  * OpenStreetMap building=* polygons — rasterise to masks (any city)
Fine-tune from a COCO checkpoint rather than training from scratch: a few
hundred labelled tiles on top of yolov8n/s beats thousands from zero.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = ROOT / "data" / "dataset"

AERIAL_DEFAULTS = {
    "imgsz": 1024,      # 640 is far too small for small roofs in a big frame
    "epochs": 120,
    "batch": 8,
    "patience": 25,
    "workers": 4,
    "optimizer": "auto",
    "pretrained": True,  # fine-tune a COCO checkpoint, never from scratch
}

DATA_YAML_TEMPLATE = """# Ultralytics dataset descriptor for the urban parcel detector.
# path is relative to this file.
path: .
train: images/train
val: images/val

# Rename to match your labels. A single 'building' class is the usual start.
names:
  0: building

# Optional extra classes (uncomment + relabel before training):
#  1: road
#  2: water
#  3: vegetation
"""


def _p(msg: str) -> None:
    print(msg)


def cmd_scaffold(args) -> int:
    root = Path(args.dataset)
    for sub in ("images/train", "images/val", "labels/train", "labels/val"):
        (root / sub).mkdir(parents=True, exist_ok=True)
        (root / sub / ".gitkeep").touch()
    yaml = root / "data.yaml"
    if yaml.exists() and not args.force:
        _p(f"data.yaml already exists at {yaml} (use --force to overwrite)")
    else:
        yaml.write_text(DATA_YAML_TEMPLATE, encoding="utf-8")
        _p(f"wrote {yaml}")
    readme = root / "README.md"
    if not readme.exists():
        readme.write_text(
            "# Detector training dataset\n\n"
            "Expected layout (created by `python tools/train_detector.py scaffold`):\n\n"
            "```\ndata.yaml\nimages/train/*.jpg   labels/train/*.txt\nimages/val/*.jpg     labels/val/*.txt\n```\n\n"
            "Each `.txt` holds one detection per line, normalised to 0-1:\n"
            "`<class_id> <x_center> <y_center> <width> <height>`\n\n"
            "Label only `building` (class 0) until the model is stable; add\n"
            "road/water/vegetation classes afterwards and update `data.yaml`.\n\n"
            "Public sources with building footprints already labelled are listed\n"
            "in `models/README.md`.\n",
            encoding="utf-8",
        )
        _p(f"wrote {readme}")
    _p(f"\nScaffold ready under {root}")
    return 0


def _count_pairs(root: Path) -> tuple[int, int, list[str]]:
    problems: list[str] = []
    total_img = total_lbl = 0
    for split in ("train", "val"):
        img_dir = root / "images" / split
        lbl_dir = root / "labels" / split
        if not img_dir.is_dir():
            problems.append(f"missing directory: {img_dir}")
            continue
        imgs = [p for p in img_dir.iterdir()
                if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}]
        total_img += len(imgs)
        if not imgs:
            problems.append(f"{img_dir} contains no images")
        for img in imgs[:5]:  # spot-check a few for matching labels
            lbl = lbl_dir / f"{img.stem}.txt"
            if lbl.exists():
                total_lbl += 1
            else:
                problems.append(f"image without a label: {img.name}")
        missing_labels = sum(
            1 for img in imgs if not (lbl_dir / f"{img.stem}.txt").exists()
        )
        if missing_labels:
            _p(f"  {split}: {len(imgs)} images, {missing_labels} without a matching .txt")
    return total_img, total_lbl, problems


def cmd_check(args) -> int:
    root = Path(args.dataset)
    _p(f"Dataset: {root}")
    if not root.is_dir():
        _p(f"[FAIL] dataset directory does not exist. Create it with:\n"
           f"       python tools/train_detector.py scaffold --dataset {root}")
        return 1
    if not (root / "data.yaml").is_file():
        _p("[FAIL] data.yaml is missing — run: python tools/train_detector.py scaffold")

    n_img, n_lbl, problems = _count_pairs(root)
    _p(f"[ ok ] images found: {n_img}, with labels: {n_lbl}")
    for pr in problems:
        _p(f"[warn] {pr}")

    # Environment
    env = ROOT / "tools" / "check_env.py"
    _p("\n--- environment ---")
    import subprocess
    py = ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
    if Path(py).exists():
        subprocess.run([py, str(env)], check=False)
    else:
        _p(f"[warn] backend venv not found at {py}")

    ready = n_img > 0 and n_lbl > 0 and (root / "data.yaml").is_file()
    _p("")
    if ready:
        _p("Dataset looks trainable. When torch works:\n"
           f"    python tools/train_detector.py train --dataset {root}")
    else:
        _p("Dataset is NOT ready. Label images (see models/README.md for public\n"
           "building-footprint datasets) and re-run this check.")
    return 0 if ready else 1


def cmd_train(args) -> int:
    root = Path(args.dataset)
    if not (root / "data.yaml").is_file():
        _p(f"[FAIL] {root / 'data.yaml'} not found — run 'check' first.")
        return 1
    try:
        from ultralytics import YOLO  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        _p(f"[FAIL] ultralytics/torch unavailable: {exc}\n"
           "       Run: python tools/check_env.py  and follow the printed fixes.")
        return 1

    weights = args.weights or "yolov8n.pt"
    _p(f"Fine-tuning {weights} on {root / 'data.yaml'}")
    _p(f"  imgsz={args.imgsz} epochs={args.epochs} batch={args.batch} device={args.device}")
    model = YOLO(weights)
    model.train(
        data=str(root / "data.yaml"),
        imgsz=args.imgsz,
        epochs=args.epochs,
        batch=args.batch,
        patience=AERIAL_DEFAULTS["patience"],
        workers=AERIAL_DEFAULTS["workers"],
        device=args.device,
        project=str(ROOT / "runs"),
        name="urban-detector",
        exist_ok=True,
    )
    best = ROOT / "runs" / "urban-detector" / "weights" / "best.pt"
    _p(f"\nDone. Copy the result into models/ so the backend picks it up:\n"
       f"    copy \"{best}\" models\\building_yolov8n.pt\n"
       f"then restart the backend and POST /api/cache/clear")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("check", "scaffold", "train"))
    ap.add_argument("--dataset", default=str(DEFAULT_DATASET))
    ap.add_argument("--weights", default=None, help="checkpoint to fine-tune (default yolov8n.pt)")
    ap.add_argument("--imgsz", type=int, default=AERIAL_DEFAULTS["imgsz"])
    ap.add_argument("--epochs", type=int, default=AERIAL_DEFAULTS["epochs"])
    ap.add_argument("--batch", type=int, default=AERIAL_DEFAULTS["batch"])
    ap.add_argument("--device", default="cpu", help="cpu | 0 | 0,1")
    ap.add_argument("--force", action="store_true", help="overwrite data.yaml")
    args = ap.parse_args()
    return {"check": cmd_check, "scaffold": cmd_scaffold, "train": cmd_train}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
