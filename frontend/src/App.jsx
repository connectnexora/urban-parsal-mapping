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
import ChangeView from './components/ChangeView.jsx';
import BootScreen from './components/BootScreen.jsx';
import DemoBanner from './components/DemoBanner.jsx';
import { DEMO_DETECTION, DEMO_PARCELS, DEMO_FEATURES, DEMO_META } from './data/demoResults.js';
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
  // Optional change-detection result (Image A older vs Image B newer).
  const [changeResult, setChangeResult] = useState(null);
  const [changeError, setChangeError] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  // Client-measured run timings (ms) + uploaded file info for the report.
  const [timings, setTimings] = useState({});
  const [uploadedInfo, setUploadedInfo] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  // Controlled demo mode: 'off' | 'loading' | 'active'. Demo data is
  // precomputed and only fills display state — never the live pipeline.
  const [demoMode, setDemoMode] = useState('off');
  const [demoStage, setDemoStage] = useState('');
  const [demoError, setDemoError] = useState(null);

  const selectParcel = (id) => setSelectedParcelId(id);
  const recordTiming = (key, ms, extra) => {
    setTimings((prev) => ({ ...prev, [key]: ms }));
    if (extra?.filename) setUploadedInfo(extra);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const enterDemo = async () => {
    if (demoMode !== 'off' || isDetecting || isExtracting || isComparing) return;
    setDemoMode('loading');
    setDemoError(null);
    setIsExtracting(true);
    try {
      const abs = (p) => new URL(String(p || '').replace(/^\//, ''), window.location.href).href;
      setDemoStage('Loading prepared demo image…');
      const imgUrl = abs('demo/demo-aerial.png');
      const annUrl = abs('demo/demo-aerial-annotated.png');
      const resp = await fetch(imgUrl);
      if (!resp.ok) {
        throw new Error(
          `Demo image not found (HTTP ${resp.status}). Regenerate it with: node tools/make-demo-scene.mjs`,
        );
      }
      const blob = await resp.blob();
      // Demo replaces any live/change state: mixed frames would misalign the
      // schematic map, which derives one shared frame from result dims.
      setChangeResult(null);
      setChangeError(null);
      setSelectedParcelId(null);
      setOriginalPreview(imgUrl);
      setDemoStage('Replaying precomputed AI results (no live inference)…');
      await sleep(900);
      const withAnn = (o) => ({ ...o, annotated_image: annUrl });
      setDetection(withAnn(DEMO_DETECTION));
      setFeatures(withAnn(DEMO_FEATURES));
      setParcelResult(withAnn(DEMO_PARCELS));
      setDetectionError(null);
      setFeaturesError(null);
      setParcelError(null);
      setUploadedInfo({
        filename: 'demo-aerial.png',
        width: DEMO_META.image.width,
        height: DEMO_META.image.height,
        size_bytes: blob.size,
      });
      setTimings({});
      setDemoStage('Rendering parcels, detections and map…');
      await sleep(700);
      setDemoMode('active');
    } catch (err) {
      setDemoError(err.message || 'Could not load the demo dataset.');
      setDemoMode('off');
    } finally {
      setIsExtracting(false);
    }
  };

  const exitDemo = () => {
    setDemoMode('off');
    setDemoStage('');
    setDemoError(null);
    setDetection(null);
    setDetectionError(null);
    setFeatures(null);
    setFeaturesError(null);
    setParcelResult(null);
    setParcelError(null);
    setChangeResult(null);
    setChangeError(null);
    setIsComparing(false);
    setOriginalPreview(null);
    setSelectedParcelId(null);
    setTimings({});
    setUploadedInfo(null);
    setReportOpen(false);
  };

  return (
    <>
    <div className="app">
      <Navbar
        backendStatus={backendStatus}
        demoMode={demoMode}
        onEnterDemo={enterDemo}
        onExitDemo={exitDemo}
        busy={isDetecting || isExtracting}
      />
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
          demoMode={demoMode}
          onEnterDemo={enterDemo}
        />
        <MapView
          parcelResult={parcelResult}
          detection={detection}
          featureResult={features}
          overlayUrl={originalPreview}
          selectedParcelId={selectedParcelId}
          onSelectParcel={selectParcel}
          changeResult={changeResult}
        />
        <ResultsPanel
          backendStatus={backendStatus}
          healthData={healthData}
          detection={detection}
          features={features}
          parcelResult={parcelResult}
        />
      </main>
      <DemoBanner
        mode={demoMode}
        stage={demoStage}
        error={demoError}
        meta={DEMO_META}
        counts={{
          parcels: DEMO_PARCELS.parcel_count,
          buildings: DEMO_DETECTION.building_count,
          features: DEMO_FEATURES.counts.total,
        }}
        onExit={exitDemo}
      />
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
      <ChangeView
        changeResult={changeResult}
        setChangeResult={setChangeResult}
        setChangeError={setChangeError}
        isComparing={isComparing}
        setIsComparing={setIsComparing}
        recordTiming={recordTiming}
        setBackendStatus={setBackendStatus}
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
      {!booted && <BootScreen onDone={() => setBooted(true)} />}
    </>
  );
}
