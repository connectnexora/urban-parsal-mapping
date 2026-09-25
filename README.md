# AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction

Hackathon prototype: **Drone/Aerial Image → Upload → AI Analysis → Buildings + Approximate Parcels → Boundaries → Area → Interactive Map → Report**.

> AI Went live: YOLO building detection (`POST /detect/buildings`) and
> approximate parcel polygons (`POST /detect/parcels`) and multi-class features (`POST /detect/features`) run real inference.
> Parcel boundaries are **AI-estimated/approximate — NOT legally valid
> cadastral boundaries**.

## Tech stack

| Layer    | Choice                                              |
| -------- | --------------------------------------------------- |
| Frontend | React (Vite) + Leaflet                              |
| Backend  | Python + FastAPI                                    |
| AI       | Ultralytics YOLO (+YOLO-seg when available), OpenCV watershed/contour fallback |

## Project structure

```
urban-parsal-mapping/
├── frontend/               # React + Vite + Leaflet UI
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── .env.example
│   └── src/
│       ├── main.jsx        # entry, Leaflet CSS import
│       ├── App.jsx         # 3-column layout + detection/parcel state
│       ├── index.css / App.css
│       ├── components/
│       │   ├── Navbar.jsx
│       │   ├── UploadPanel.jsx  # file pick, upload, detect, extract parcels
│       │   ├── MapView.jsx      # Leaflet map + schematic parcel polygons
│       │   ├── ResultsPanel.jsx # live counters (blank until inference)
│       │   ├── DetectionResults.jsx
│       │   └── ParcelResults.jsx  # approximate parcels + disclaimer
│       └── services/api.js # axios client → FastAPI
├── backend/                # FastAPI AI API
│   ├── main.py             # /, /api/health, /api/info, /upload, /detect/*
│   ├── requirements.txt
│   ├── services/detection.py  # YOLO building detection (safe load)
│   ├── services/parcels.py    # parcel pipeline (segmentation → polygons)
│   └── utils/geo.py           # pixel→metric estimates, GeoJSON helpers
├── models/                 # weights go here (git-ignored, see models/README.md)
├── data/
│   ├── uploads/            # files saved by POST /upload (git-ignored)
│   └── samples/            # put demo drone images here
├── outputs/                # annotated images + GeoJSON (git-ignored, served at /outputs/*)
│   ├── reports/
│   └── maps/
└── README.md
```

## Prerequisites

- **Node.js 18+**
- **Python 3.10+** — install from [python.org](https://www.python.org/downloads/) and tick
  **"Add python.exe to PATH"**, then reopen the terminal.

## 1 · Start the backend

```powershell
cd "C:\Users\Shripat\Desktop\project duo 1\p1\urban-parsal-mapping\backend"

# (first time) create + activate a virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt

# run the API (from the backend/ folder)
uvicorn main:app --reload --port 8000
```

Verify: open http://localhost:8000/api/health → expect `{"status":"ok",...}`.
Interactive docs: http://localhost:8000/docs

## 2 · Start the frontend

```powershell
cd "C:\Users\Shripat\Desktop\project duo 1\p1\urban-parsal-mapping\frontend"
npm.cmd install
npm.cmd run dev
```

Open the printed URL (default http://localhost:5173).

> Note: on this machine `npm` must be invoked as `npm.cmd` (PowerShell
> execution policy blocks `npm.ps1`).

## 3 · Test the pipeline

1. Start both servers (backend `:8000`, frontend `:5173`).
2. In the UI, left panel → **"Test Backend Connection"**.
3. Upload a JPG/PNG/TIF → **Upload to Backend** (live progress, server-validated
   dimensions).
4. **Detect Buildings (YOLO)** → `POST /detect/buildings` returns
   `detections:[{class, confidence, bbox}]` + annotated image in `outputs/`.
   Without a building-trained weight in `models/`, the generic COCO fallback
   returns real (non-building) labels + a 503-safe warning — never fake boxes.
5. **Extract Parcels (polygons)** → `POST /detect/parcels` runs
   preprocessing → segmentation (YOLO-seg `*-seg.pt` when present, else OpenCV
   watershed/contours) → boundary extraction → `approxPolyDP` simplification →
   area/perimeter estimates via GSD. Returns
   `parcels:[{parcel_id, area, perimeter, confidence, polygon}]` plus annotated
   image + GeoJSON in `outputs/`, overlaid as schematic polygons on the map.6. **Process Image \(AI Features\)** ? `POST /detect/features` returns `features:{buildings, roads, vegetation, water, other}` with per-item class/confidence/geometry plus annotated image; empty categories stay empty with reasons.
   Everywhere labelled **AI-estimated/approximate, NOT legal cadastre**.

## Demo Dataset (DEMO MODE)

No backend or drone footage handy? Click **Demo Dataset** (navbar, or "Try Demo Dataset" in the upload panel).

- Loads a prepared synthetic aerial scene (`frontend/public/demo/demo-aerial.png`, 960x640, GSD 0.5 m/px).
- Plays a short staged loading sequence, then displays **precomputed** results:
  6 parcel polygons, 8 building detections, 16 multi-class features, statistics,
  map overlays, comparison slider and a working Generate-Report flow.
- Everything is labelled **DEMO MODE � precomputed**. No backend calls run;
  the live AI pipeline is untouched, and demo numbers are never presented as
  live inference.

Regenerate the dataset any time (zero dependencies, runs on node):

```powershell
node tools/make-demo-scene.mjs
```

This rewrites `frontend/public/demo/*.png` and `frontend/src/data/demoResults.js`
from a single seeded generator, so image geometry and precomputed results
always match.

## Segmentation models

- Preferred when present: `models/*-seg.pt` (YOLO-seg, e.g. custom
  parcel/footprint model trained on SpaceNet / OpenCities AI / INRIA / CrowdAI).
- Detected + reported: `*unet*`, `*sam*` weights (need torch +
  segmentation-models-pytorch / segment-anything — otherwise the service says
  so and uses the classical fallback).
- Fallback (always available): OpenCV bilateral + CLAHE → Otsu/adaptive →
  morphology → distance-transform watershed → contour polygons.
- See `models/README.md` for the full weight guide.
