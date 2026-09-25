# models/

Place YOLO weight files here. The backend loads them **safely at startup**
(`backend/services/detection.py`) — if nothing usable is found, the API stays
up but `POST /detect/buildings` returns **HTTP 503 with instructions**
instead of fake boxes.

## What you need for real building detection

The default fallback `yolov8n.pt` (auto-downloaded by `ultralytics`) is trained
on **COCO**, which has **no `building` class** — it can only return generic
labels (car, person, …) with `building_count: 0` plus a warning. For actual
buildings, drop in a **custom-trained YOLO weight** with a `building` class,
e.g.:

| File in `models/`              | Trained on (examples)                                  |
| ------------------------------ | ------------------------------------------------------ |
| `building_yolov8n.pt`          | xView / DOTA-v2 / SpaceNet / OpenCities AI / INRIA     |
| `building_yolov8s.pt`          | CrowdAI Mapping Challenge / your own drone survey      |
| Any `*building*.pt`, `*xview*.pt`, `*dota*.pt`, `*spacenet*.pt`, `*inria*.pt` | matched first by filename hint |

Any `*.pt` / `*.onnx` whose model classes include `building` (or `house`,
`roof`, `building_footprint`, …) is treated as building-capable.

## Suggested datasets

- **xView** (DIUx xView detection challenge — `building` class)
- **DOTA-v2** (aerial objects;harbor/plane/small-vehicle + buildings via OBB)
- **SpaceNet** (building footprints, Vegas/Paris/Shanghai/Khartoum)
- **OpenCities AI** (African building footprints, Drone vs. satellite)
- **INRIA Aerial Image Labeling** (building / not-building segmentation)
- **CrowdAI Mapping Challenge** (building footprints)

Train with `ultralytics` (`yolo detect train data=building.yaml model=yolov8n.pt
epochs=…`), copy the resulting `best.pt` here as e.g.
`models/building_yolov8n.pt`, and restart the backend.

Alternatively point the backend at a weight anywhere with:

```powershell
$env:YOLO_MODEL_PATH="models/building_yolov8n.pt"
uvicorn main:app --reload --port 8000
```

## Segmentation weights (parcels)

`POST /detect/parcels` prefers learned masks when available, else uses an
OpenCV watershed/contour fallback (always labelled approximate):

- `*-seg.pt` / `*-seg.onnx` — YOLO-seg models run via `ultralytics`
  (e.g. `yolov8n-seg.pt` for smoke-testing, or a custom parcel/footprint
  model trained on SpaceNet / OpenCities AI / INRIA / CrowdAI). Masks are
  converted to simplified polygons.
- `*unet*.pt` / `*unet*.onnx` — U-Net weights (need `torch` +
  `segmentation-models-pytorch`; the backend detects the file and tells you
  if the runtime is missing instead of faking results).
- `*sam*.pth` / `*sam*.pt` — SAM/SAM2 weights (need `torch` +
  `segment-anything` / `sam2`); likewise detected and reported.

Without any of these, the classical fallback runs and `method` in the
response reads `classical-watershed-contours`.

## Notes

- Large `*.pt / *.onnx / *.pth / *.bin` files are git-ignored — download or
  train them separately and document the source + version here.
- Without a custom weight the backend still runs: it uses `yolov8n.pt`
  transparently and tells you so in `model_type: "generic-coco"` + `warning`.
