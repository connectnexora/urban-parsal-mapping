import { useState } from 'react';
import Navbar from './components/Navbar.jsx';
import UploadPanel from './components/UploadPanel.jsx';
import MapView from './components/MapView.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import DetectionResults from './components/DetectionResults.jsx';
import './App.css';

export default function App() {
  // 'unknown' | 'ok' | 'down'
  const [backendStatus, setBackendStatus] = useState('unknown');
  const [healthData, setHealthData] = useState(null);
  // Real YOLO result from POST /detect/buildings (null until a run finishes).
  const [detection, setDetection] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
  const [originalPreview, setOriginalPreview] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);

  return (
    <div className="app">
      <Navbar backendStatus={backendStatus} />
      <main className="layout">
        <UploadPanel
          backendStatus={backendStatus}
          setBackendStatus={setBackendStatus}
          setHealthData={setHealthData}
          setDetection={setDetection}
          setDetectionError={setDetectionError}
          setOriginalPreview={setOriginalPreview}
          isDetecting={isDetecting}
          setIsDetecting={setIsDetecting}
        />
        <MapView />
        <ResultsPanel
          backendStatus={backendStatus}
          healthData={healthData}
          detection={detection}
        />
      </main>
      <DetectionResults
        detection={detection}
        error={detectionError}
        originalPreview={originalPreview}
        isDetecting={isDetecting}
      />
      <footer className="footer">
        <span>YOLO building detection · POST /detect/buildings · annotated outputs in outputs/</span>
        <span>React + Leaflet · FastAPI · Ultralytics YOLO + OpenCV</span>
      </footer>
    </div>
  );
}
