# AI-Based Automated Urban Parcel Mapping and Cadastral Feature Extraction

Hackathon prototype: **Drone/Aerial Image → Upload → AI Analysis → Buildings/Roads/Parcels → Boundaries → Area → Interactive Map → Parcel Report**.

> **Step 1 status:** project structure + basic frontend/backend connection only.
> No AI inference, no fake results. Counters stay blank until Step 2 wires up real detection.

## Tech stack

| Layer    | Choice                          |
| -------- | ------------------------------- |
| Frontend | React (Vite) + Leaflet          |
| Backend  | Python + FastAPI                |
| AI (Step 2) | OpenCV + YOLO + segmentation |

## Project structure

```
urban-parsal-mapping/
├── frontend/               # React + Vite + Leaflet demo UI
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── .env.example
│   └── src/
│       ├── main.jsx        # entry, Leaflet CSS import
│       ├── App.jsx         # 3-column layout
│       ├── index.css / App.css
│       ├── components/
│       │   ├── Navbar.jsx       # title bar + backend badge
│       │   ├── UploadPanel.jsx  # file pick, upload, test-connection
│       │   ├── MapView.jsx      # Leaflet map shell (Bengaluru default)
│       │   └── ResultsPanel.jsx # blank counters until Step 2
│       └── services/api.js # axios client → FastAPI
├── backend/                # FastAPI connectivity API (no AI yet)
│   ├── main.py             # /, /api/health, /api/info, /api/upload
│   ├── requirements.txt
│   ├── services/detection.py  # STUB — raises NotImplementedError
│   └── utils/geo.py           # STUB — area/geo helpers for later
├── models/                 # YOLO weights go here in Step 2 (git-ignored)
├── data/
│   ├── uploads/            # files saved by POST /api/upload (git-ignored)
│   └── samples/            # put demo drone images here
├── outputs/
│   ├── reports/            # parcel/property reports (Step 3+)
│   └── maps/               # annotated overlays / GeoJSON (Step 2+)
└── README.md
```

## Prerequisites

- **Node.js 18+** (you have it — verified `node v24`, `npm 12`)
- **Python 3.10+** — ⚠️ not found on this machine yet (only a Store stub).
  Install from [python.org](https://www.python.org/downloads/) and tick
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

## 3 · Test frontend ↔ backend communication

1. Start both servers (backend `:8000`, frontend `:5173`).
2. In the UI, left panel → **"Test Backend Connection"**.
   - ✅ Success: `Backend responded: ok` + green badge in the navbar.
   - ❌ Failure: red badge — backend isn't running or wrong `VITE_API_URL`.
3. Or bypass the UI:
   - `curl http://localhost:8000/api/health`
   - Frontend `API: http://localhost:8000` label shows which backend it targets.
4. Upload test: choose any JPG/PNG → **Upload to Backend** →
   backend saves it under `data/uploads/` and replies
   `"AI analysis is not implemented yet"` with `detections: null`
   (deliberately no fake boxes).

## What's next (Step 2)

- Load YOLO weights from `models/` in `backend/services/detection.py`
- OpenCV segmentation → boundaries → `utils/geo.py` area calc
- Return real GeoJSON detections; overlay polygons in `MapView.jsx`
- Generate parcel report into `outputs/reports/`
