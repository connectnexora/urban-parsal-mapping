import { useState } from 'react';
import Navbar from './components/Navbar.jsx';
import UploadPanel from './components/UploadPanel.jsx';
import MapView from './components/MapView.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import './App.css';

export default function App() {
  // 'unknown' | 'ok' | 'down'
  const [backendStatus, setBackendStatus] = useState('unknown');
  const [healthData, setHealthData] = useState(null);

  return (
    <div className="app">
      <Navbar backendStatus={backendStatus} />
      <main className="layout">
        <UploadPanel
          backendStatus={backendStatus}
          setBackendStatus={setBackendStatus}
          setHealthData={setHealthData}
        />
        <MapView />
        <ResultsPanel backendStatus={backendStatus} healthData={healthData} />
      </main>
      <footer className="footer">
        <span>Hackathon prototype · Step 1: structure + connectivity (no AI yet)</span>
        <span>React + Leaflet · FastAPI · OpenCV/YOLO next</span>
      </footer>
    </div>
  );
}
