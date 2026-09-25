import { useState } from 'react';
import Navbar from './components/Navbar.jsx';
import UploadPanel from './components/UploadPanel.jsx';
import MapView from './components/MapView.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import DetectionResults from './components/DetectionResults.jsx';
import ParcelResults from './components/ParcelResults.jsx';
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
  // Approximate parcels from POST /detect/parcels (null until a run finishes).
  const [parcelResult, setParcelResult] = useState(null);
  const [parcelError, setParcelError] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);

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
          setParcelResult={setParcelResult}
          setParcelError={setParcelError}
          isExtracting={isExtracting}
          setIsExtracting={setIsExtracting}
        />
        <MapView parcelResult={parcelResult} />
        <ResultsPanel
          backendStatus={backendStatus}
          healthData={healthData}
          detection={detection}
          parcelResult={parcelResult}
        />
      </main>
      <DetectionResults
        detection={detection}
        error={detectionError}
        originalPreview={originalPreview}
        isDetecting={isDetecting}
      />
      <ParcelResults
        parcelResult={parcelResult}
        error={parcelError}
        originalPreview={originalPreview}
        isExtracting={isExtracting}
      />
      <footer className="footer">
        <span>YOLO buildings · Approximate parcels (NOT legal cadastre) · outputs/</span>
        <span>React + Leaflet · FastAPI · YOLO-seg / OpenCV watershed</span>
      </footer>
    </div>
  );
}
