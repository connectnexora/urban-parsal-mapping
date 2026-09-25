import { useState } from 'react';
import Navbar from './components/Navbar.jsx';
import UploadPanel from './components/UploadPanel.jsx';
import MapView from './components/MapView.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import DetectionResults from './components/DetectionResults.jsx';
import ParcelResults from './components/ParcelResults.jsx';
import ParcelDetail from './components/ParcelDetail.jsx';
import SummaryStats from './components/SummaryStats.jsx';
import ReportModal from './components/ReportModal.jsx';
import CompareView from './components/CompareView.jsx';
import './App.css';

export default function App() {
  // 'unknown' | 'ok' | 'down'
  const [backendStatus, setBackendStatus] = useState('unknown');
  const [healthData, setHealthData] = useState(null);
  // Real YOLO result from POST /detect/buildings (null until a run finishes).
  const [detection, setDetection] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
  // Full pipeline result from POST /detect/features (null until a run finishes).
  const [features, setFeatures] = useState(null);
  const [featuresError, setFeaturesError] = useState(null);
  // Approximate parcels from POST /detect/parcels (null until a run finishes).
  const [parcelResult, setParcelResult] = useState(null);
  const [parcelError, setParcelError] = useState(null);
  const [originalPreview, setOriginalPreview] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  // Parcel selected on the map (popup + sidebar details).
  const [selectedParcelId, setSelectedParcelId] = useState(null);
  // Client-measured run timings (ms) + uploaded file info for the report.
  const [timings, setTimings] = useState({});
  const [uploadedInfo, setUploadedInfo] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);

  const selectParcel = (id) => setSelectedParcelId(id);
  const recordTiming = (key, ms, extra) => {
    setTimings((prev) => ({ ...prev, [key]: ms }));
    if (extra?.filename) setUploadedInfo(extra);
  };

  return (
    <>
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
          setFeatures={setFeatures}
          setFeaturesError={setFeaturesError}
          setParcelResult={setParcelResult}
          setParcelError={setParcelError}
          isExtracting={isExtracting}
          setIsExtracting={setIsExtracting}
          recordTiming={recordTiming}
        />
        <MapView
          parcelResult={parcelResult}
          detection={detection}
          featureResult={features}
          overlayUrl={originalPreview}
          selectedParcelId={selectedParcelId}
          onSelectParcel={selectParcel}
        />
        <ResultsPanel
          backendStatus={backendStatus}
          healthData={healthData}
          detection={detection}
          features={features}
          parcelResult={parcelResult}
        />
      </main>
      {selectedParcelId && (
        <ParcelDetail
          parcelResult={parcelResult}
          detection={detection}
          featureResult={features}
          selectedParcelId={selectedParcelId}
          onClose={() => setSelectedParcelId(null)}
        />
      )}
      <DetectionResults
        detection={detection}
        error={detectionError}
        originalPreview={originalPreview}
        isDetecting={isDetecting}
        features={features}
        featuresError={featuresError}
        isExtracting={isExtracting}
      />
      <ParcelResults
        parcelResult={parcelResult}
        error={parcelError}
        originalPreview={originalPreview}
        isExtracting={isExtracting}
        selectedParcelId={selectedParcelId}
        onSelectParcel={selectParcel}
        onGenerateReport={() => setReportOpen(true)}
      />
      <SummaryStats
        parcelResult={parcelResult}
        detection={detection}
        featureResult={features}
      />
      <CompareView
        detection={detection}
        features={features}
        parcelResult={parcelResult}
        originalPreview={originalPreview}
      />
      <footer className="footer">
        <span>YOLO buildings · Approximate parcels (NOT legal cadastre) · Feature pipeline · outputs/</span>
        <span>React + Leaflet · FastAPI · YOLO-seg / watershed / colour segmentation</span>
      </footer>
    </div>
      {reportOpen && parcelResult && (
        <ReportModal
          parcelResult={parcelResult}
          detection={detection}
          features={features}
          timings={timings}
          uploadedInfo={uploadedInfo}
          originalPreview={originalPreview}
          onClose={() => setReportOpen(false)}
        />
      )}
    </>
  );
}
