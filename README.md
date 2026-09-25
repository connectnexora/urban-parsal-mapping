# Urban Parcel Mapping — GIS/AI Dashboard

Professional GIS/AI dashboard for drone-based parcel, building, and road detection.

## Features

- **Header** — project branding, AI status indicator (Standby / Processing / Ready), system status, live clock
- **Left sidebar** — Upload Drone Image, Process Image, Parcel / Building / Road detection layer toggles, Reports
- **Interactive map** — pan (drag), zoom (wheel + buttons + reset), 3 local basemaps (Satellite / Streets / Dark),
  parcel polygons (click to inspect), building footprints, road centerlines, coordinate readout, scale bar
- **Right panel** — parcel/building counts, estimated total area (shoelace, 1 unit = 0.5 m), processing status,
  AI confidence bar, selected-parcel details, legend
- **Bottom section** — animated processing progress + auto-scrolling detection logs, local GeoJSON export
- **Reports** — summary modal with parcel table, CSV / GeoJSON download (browser-generated), print stylesheet
- **100% local** — no external tile servers, fonts, APIs, or network calls. Fully functional offline;
  the detection pipeline is simulated in-browser (`src/hooks/useProcessing.js`) with the same state
  contract a real model backend will use.

## Getting started

```bash
npm install
npm run dev      # local dev server (default http://localhost:5173)
npm run build    # production build -> dist/
npm run preview  # serve the production build
```

## Project structure

```
src/
  App.jsx                 # dashboard shell + state wiring
  main.jsx                # entry point
  index.css               # theme, layout, responsive breakpoints
  data/sampleData.js      # local survey extent (parcels, buildings, roads)
  utils/geo.js            # area / centroid / formatting helpers
  utils/export.js         # local CSV + GeoJSON download (Blob, no network)
  hooks/useProcessing.js  # simulated AI pipeline (timers only)
  components/
    Header.jsx  Sidebar.jsx  MapView.jsx  InfoPanel.jsx
    BottomPanel.jsx  ReportsModal.jsx  StatCard.jsx
```

## Connecting a real model later

Replace the timer script inside `useProcessing.start()` with model inference calls.
Keep the returned shape (`phase`, `progress`, `stageLabel`, `logs`, `revealed`, `confidence`)
and every component continues to work unchanged.
