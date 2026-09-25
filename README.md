# AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction

Drone/aerial image → upload → preprocessing → AI building/feature detection →
segmentation → parcel polygons → area estimation → interactive Leaflet map →
parcel report (PDF) → optional change detection.

> **Important:** all parcel boundaries produced by this prototype are
> **AI-estimated approximations for visualisation and analysis only**.
> This prototype does **not** provide legally authoritative cadastral
> surveying. Detected changes must be verified by a surveyor or relevant
> authority before any planning, legal or cadastral use.

## Features

- **Landing/loading experience** — "AI + Drone + GIS + Smart City" boot
  sequence (imagery → AI processing → feature extraction → parcel mapping →
  digital cadastral map) with skip support and reduced-motion handling.
- **Upload** — JPG/PNG/TIF/TIFF with client + server validation (type, MIME,
  100 MB limit, corruption check), progress bar, TIFF fallback notice.
- **Building detection (YOLO)** — `POST /detect/buildings` returns boxes,
  class names and confidence scores plus an annotated image in `outputs/`.
- **Parcel extraction** — `POST /detect/parcels` runs preprocessing →
  segmentation (YOLO-seg when available, else OpenCV watershed/contours) →
  boundary extraction → polygon simplification → area (m² + ha) and perimeter
  (m) estimates, honouring embedded GeoTIFF spatial tags when present.
- **Feature pipeline** — `POST /detect/features` returns
  buildings/roads/vegetation/water/other with per-item geometry; empty
  categories stay empty with reasons (never fabricated).
- **Interactive Leaflet map** — parcel polygons (click for Parcel ID, area,
  perimeter, building coverage, confidence), building/road/feature layers,
  change overlays (UNCHANGED/NEW/REMOVED/CHANGED), Streets/Satellite toggle,
  layer control, fit-to-detected-area, scale bar.
- **Visual comparison** — original vs AI-processed slider with layer tabs.
- **Parcel report** — Generate Report modal (image info, processing times,
  detection summary, parcel table, map snapshot) with PDF export via print.
- **Change detection (optional)** — upload older Image A + newer Image B;
  ECC alignment, YOLO + parcel matching, structural diff; NEW/REMOVED/
  CHANGED/UNCHANGED results on the map with construction-zone summary.
- **Demo mode** — one-click prepared synthetic dataset with precomputed
  results, always labelled DEMO MODE (see below).

## Architecture

```
urban-parsal-mapping/
├── frontend/                 # React (Vite) + Leaflet UI
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js        # dev server :5173, proxies /api /detect /outputs → :8000
│   ├── .env.example          # optional VITE_API_URL override
│   ├── public/demo/          # prepared demo image + annotated image
│   └── src/
│       ├── main.jsx          # entry, Leaflet CSS import
│       ├── App.jsx           # state hub (results, timings, demo, report, boot)
│       ├── index.css / App.css
│       ├── data/demoResults.js   # generated precomputed demo results
│       ├── utils/mapGeo.js       # pixel→map math, coverage, summaries, GeoJSON
│       ├── services/api.js       # axios client → FastAPI
│       └── components/
│           ├── BootScreen.jsx      # landing/loading sequence
│           ├── Navbar.jsx          # status + demo entry
│           ├── UploadPanel.jsx     # upload, detect, parcels, features
│           ├── MapView.jsx         # Leaflet overlays + parcel selection
│           ├── ResultsPanel.jsx    # live counters
│           ├── DetectionResults.jsx
│           ├── ParcelResults.jsx   # parcel table + Generate Report button
│           ├── ParcelDetail.jsx    # selected-parcel sidebar
│           ├── SummaryStats.jsx    # totals, averages, largest parcel
│           ├── CompareView.jsx     # original vs processed slider
│           ├── ChangeView.jsx      # A/B change detection UI
│           ├── ReportModal.jsx     # PDF report (print pipeline)
│           └── DemoBanner.jsx      # DEMO MODE banner
├── backend/                  # FastAPI AI API
│   ├── main.py               # routes, validation, /outputs static mount
│   ├── requirements.txt
│   ├── services/
│   │   ├── detection.py      # YOLO building detection (safe load)
│   │   ├── parcels.py        # segmentation → polygons → metric estimates
│   │   ├── features.py       # YOLO + colour-segmentation taxonomy
│   │   └── changes.py        # A/B change detection pipeline
│   └── utils/geo.py          # pixel→metric helpers, GeoJSON builders
├── tools/
│   └── make-demo-scene.mjs   # zero-dependency demo dataset generator (node)
├── models/                   # YOLO weights (git-ignored, see below)
├── data/
│   ├── uploads/              # received images (git-ignored)
│   └── samples/              # put 2–3 sample drone images here
└── outputs/                  # annotated images + GeoJSON (git-ignored, served at /outputs/*)
    ├── maps/
    └── reports/
```

Data flow per image: upload (`data/uploads/`) → preprocessing (backend,
OpenCV/PIL) → inference (`models/` weights or classical fallback) →
polygons + metric estimates → annotated JPEG + GeoJSON (`outputs/`, served at
`/outputs/*`) → Leaflet schematic overlay (image-pixel geometry fitted around
the demo centre — not georeferenced) + tables/statistics/report.

## Technology stack

| Layer    | Choice |
| -------- | ------ |
| Frontend | React 18 + Vite 5 + Leaflet 1.9 / react-leaflet 4 + axios |
| Backend  | Python 3.10+ + FastAPI + uvicorn |
| AI       | Ultralytics YOLO (+YOLO-seg weights when present), OpenCV, shapely, Pillow |
| Geo      | GeoJSON (image-pixel CRS unless source GeoTIFF is projected), GSD-based metric estimates |

## Installation

Prerequisites: **Node.js 18+**, **Python 3.10+** (tick "Add python.exe to
PATH" on Windows).

```powershell
# Backend dependencies (creates an isolated venv)
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Frontend dependencies
cd ..\frontend
npm.cmd install
```

> Note: on this machine `npm` must be invoked as `npm.cmd` (PowerShell
> execution policy blocks `npm.ps1`).

## How to run the backend

```powershell
cd backend
# .\.venv\Scripts\Activate.ps1  (if not already active)
uvicorn main:app --reload --port 8000
```

- Health: http://localhost:8000/api/health → `{"status":"ok",...}`
- Interactive docs: http://localhost:8000/docs
- Annotated images / GeoJSON: http://localhost:8000/outputs/...
- The server starts even with no model weights; AI endpoints then return
  HTTP 503 with setup instructions instead of fake results.

## How to run the frontend

```powershell
cd frontend
npm.cmd run dev      # http://localhost:5173
npm.cmd run build    # production build -> dist/
npm.cmd run preview  # serve the production build
```

Optional: copy `frontend/.env.example` to `frontend/.env` to point at a
non-local backend via `VITE_API_URL`. From a clean startup, start the
backend first, then the frontend, then use **Test Backend Connection**.

## Required AI models

Place weight files in `models/` (git-ignored) and restart the backend.
All model loading is safe: missing/incompatible weights degrade honestly.

| File in `models/` | Purpose |
| ----------------- | ------- |
| `building_yolov8n.pt` (or `*building*`, `*xview*`, `*dota*`, `*spacenet*`, `*inria*`) | Custom YOLO with a `building` class (trained on xView / DOTA-v2 / SpaceNet / OpenCities AI / INRIA / CrowdAI) |
| `*-seg.pt` / `*-seg.onnx` | YOLO-seg weights for learned parcel/footprint masks |
| `*unet*`, `*sam*` | Detected and reported; need torch + segmentation libs, otherwise the classical fallback runs |

Without a custom weight, the auto-downloaded generic COCO `yolov8n.pt` is
used transparently: it has **no `building` class**, so building counts stay
0 with an explanatory warning. `YOLO_MODEL_PATH` env var can point at a
weight elsewhere. See `models/README.md`.

## Dataset requirements

- Accepted: **JPG, JPEG, PNG, TIF, TIFF (GeoTIFF)** — validated client-side
  (extension, MIME, empty-file, corruption via image decode) and server-side
  (extension, 100 MB limit, full PIL decode, decompression-bomb guard).
- Oversized files → HTTP 413; unreadable/corrupt files → HTTP 400 and the
  saved copy is deleted.
- GeoTIFFs with projected spatial tags are honoured for metric areas;
  plain JPG/PNG areas are labelled **estimated image-based** (assumed GSD,
  adjustable in the UI).
- Put reusable samples in `data/samples/` (large samples are git-ignored).

## API endpoints

| Method & path | Purpose |
| ------------- | ------- |
| `GET /` | Service info + route/disclaimer summary |
| `GET /api/health` | Liveness + model/parcel readiness |
| `GET /api/info` | Pipeline, stack, model + parcel status |
| `GET /detect/model-status`, `GET /api/detect/model-status` | YOLO load state |
| `GET /detect/parcel-status`, `GET /api/detect/parcel-status` | Segmentation readiness |
| `POST /upload`, `POST /api/upload` | Validate + store image → filename, dimensions, size (no AI) |
| `POST /detect/buildings`, `POST /api/detect/buildings` | `file` + `confidence`, `iou` → `detections:[{class, confidence, bbox}]`, counts, annotated image |
| `POST /detect/parcels`, `POST /api/detect/parcels` | `file` + `gsd`, `epsilon`, `conf`, `max_parcels` → `parcels:[{parcel_id, area_m2, area_ha, perimeter_m, confidence, polygon}]`, summary, GeoJSON, annotated image |
| `POST /detect/features`, `POST /api/detect/features` | `file` + `confidence`, `iou` → `features:{buildings, roads, vegetation, water, other}`, `counts`, `reasons`, annotated image |
| `POST /detect/changes`, `POST /api/detect/changes` | `file_a` (older) + `file_b` (newer) + `confidence`, `iou`, `align`, `gsd` → `changes:[{status, kind, ...}]` with UNCHANGED/NEW/REMOVED/CHANGED, summary, annotated change map, GeoJSON |
| `GET /outputs/<file>` | Annotated images / GeoJSON artefacts |

## Complete workflow

1. Open the app → landing/loading screen (Skip available) → dashboard.
2. Upload a drone image (validated, progress shown) → backend stores it.
3. Preprocessing begins server-side (decode, denoise/normalise).
4. **Detect Buildings** → YOLO boxes; **Process Features** → full taxonomy.
5. **Extract Parcels** → segmentation → polygon boundaries.
6. Area (m² + ha) and perimeter (m) calculated per parcel (+ totals/average/largest).
7. Results converted to map-compatible GeoJSON (image-pixel CRS).
8. Leaflet displays parcels/buildings/roads/changes with layer control.
9. Click a parcel → popup + sidebar (ID, area, perimeter, building coverage, confidence).
10. Statistics panel + summary cards update live.
11. Comparison slider: original vs AI-processed imagery.
12. **Generate Report** → modal with image info, timings, summary, parcel table, map snapshot → Export as PDF (print pipeline).
13. Optionally: change detection with an older/newer pair.

## Demo instructions

No backend or drone footage handy? Click **Demo Dataset** (navbar, or "Try
Demo Dataset" in the upload panel).

- Loads a prepared synthetic aerial scene (`frontend/public/demo/demo-aerial.png`, 960×640, GSD 0.5 m/px).
- Plays a short staged loading sequence, then displays **precomputed** results:
  6 parcel polygons, 8 building detections, 16 multi-class features, statistics,
  map overlays, comparison slider and a working Generate-Report flow.
- Everything is labelled **DEMO MODE — precomputed**. No backend calls run;
  the live AI pipeline is untouched, and demo numbers are never presented as
  live inference.

Regenerate the dataset any time (zero dependencies, runs on node):

```powershell
node tools/make-demo-scene.mjs
```

This rewrites `frontend/public/demo/*.png` and `frontend/src/data/demoResults.js`
from a single seeded generator, so image geometry and precomputed results
always match.

## Limitations

- Parcel boundaries are **approximations**, not survey-grade: segmentation
  quality depends on image resolution, lighting, viewpoint and GSD accuracy.
- Metric areas from plain JPG/PNG assume the UI GSD value; only projected
  GeoTIFFs carry real spatial scale — and even then results are estimates.
- Generic COCO weights detect no buildings; a custom building-capable model
  is required for real building counts.
- Map overlays are schematic (image pixels fitted around a demo centre),
  **not georeferenced**, and must not be used as cadastral evidence.
- Change detection needs overlapping repeat-pass frames; viewpoint/lighting
  differences inflate false changes.
- Uploads are capped at 100 MB; very large frames also slow inference.
- Annotated outputs accumulate in `outputs/` (git-ignored) — prune
  periodically on long-running servers.

## Future improvements

- True georeferencing pipeline (orthomosaic + GCP support, projected-CRS
  GeoJSON export instead of image-pixel coordinates).
- Trained building/footprint segmentation models checked into the release
  process; GPU inference path with job queue + progress streaming.
- Parcel boundary refinement (road-network-aware splitting, CRF/post-processing).
- Authentication, per-user upload quotas and background cleanup for `outputs/`.
- Automated backend tests (currently verified by code review + frontend build;
  no Python runtime on the dev machine) and CI for both stacks.
- Offline base-map packs for fully disconnected field use.

---

**Disclaimer:** AI-generated parcel boundaries and change labels are estimates
for visualization and analysis and are **not a substitute for legally
surveyed cadastral boundaries**. Verify with a surveyor or relevant authority
before any planning, legal or cadastral use.
