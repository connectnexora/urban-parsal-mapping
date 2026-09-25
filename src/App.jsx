import { useMemo, useState } from 'react'
import Header from './components/Header.jsx'
import Sidebar from './components/Sidebar.jsx'
import MapView from './components/MapView.jsx'
import InfoPanel from './components/InfoPanel.jsx'
import BottomPanel from './components/BottomPanel.jsx'
import ReportsModal from './components/ReportsModal.jsx'
import { BUILDINGS, PARCELS, ROADS } from './data/sampleData.js'
import { avgConfidence, polygonAreaM2 } from './utils/geo.js'
import { exportCSV, exportGeoJSON } from './utils/export.js'
import { useProcessing } from './hooks/useProcessing.js'

export default function App() {
  const proc = useProcessing()
  const isProcessing = proc.phase === 'processing'

  const [layers, setLayers] = useState({ parcels: true, buildings: true, roads: true, labels: true })
  const [basemap, setBasemap] = useState('satellite')
  const [selectedId, setSelectedId] = useState(null)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [image, setImage] = useState(null) // { name, size, url }
  const [showImagery, setShowImagery] = useState(true)

  // Detections revealed so far by the (simulated) pipeline.
  const parcels = useMemo(() => PARCELS.slice(0, proc.revealed.parcels), [proc.revealed.parcels])
  const buildings = useMemo(() => BUILDINGS.slice(0, proc.revealed.buildings), [proc.revealed.buildings])
  const roads = useMemo(() => ROADS.slice(0, proc.revealed.roads), [proc.revealed.roads])

  const totalAreaM2 = useMemo(() => parcels.reduce((s, p) => s + polygonAreaM2(p.points), 0), [parcels])
  const confidence = useMemo(
    () => proc.confidence ?? (proc.phase === 'done' ? avgConfidence([...parcels, ...buildings, ...roads]) : null),
    [proc.confidence, proc.phase, parcels, buildings, roads]
  )
  const selected = useMemo(() => parcels.find((p) => p.id === selectedId) || null, [parcels, selectedId])

  const aiState = isProcessing ? 'processing' : proc.phase === 'done' ? 'done' : 'idle'

  const handleUpload = (file) => {
    if (!file) return
    if (image) URL.revokeObjectURL(image.url)
    setImage({ name: file.name, size: file.size, url: URL.createObjectURL(file) })
    setShowImagery(true)
  }

  const handleProcess = () => {
    setSelectedId(null)
    proc.start(image?.name)
  }

  const handleResetAll = () => {
    proc.reset()
    setSelectedId(null)
  }

  const toggleLayer = (key) => setLayers((l) => ({ ...l, [key]: !l[key] }))

  // Sidebar process button doubles as re-run/reset once done.
  const handleSidebarProcess = () => {
    if (proc.phase === 'done') handleResetAll()
    else handleProcess()
  }

  return (
    <div className="app">
      <Header aiState={aiState} systemOk onMenu={() => setSidebarOpen((o) => !o)} />

      <Sidebar
        open={sidebarOpen}
        layers={layers}
        counts={{ parcels: parcels.length, buildings: buildings.length, roads: roads.length }}
        hasImage={!!image}
        imageName={image?.name}
        isProcessing={isProcessing}
        canProcess
        onUpload={handleUpload}
        onProcess={handleSidebarProcess}
        onToggleLayer={toggleLayer}
        onOpenReports={() => setReportsOpen(true)}
      />

      <main className="main">
        <MapView
          parcels={parcels}
          buildings={buildings}
          roads={roads}
          layers={layers}
          basemap={basemap}
          onBasemapChange={setBasemap}
          selectedId={selectedId}
          onSelect={setSelectedId}
          imageUrl={image?.url}
          showImagery={showImagery}
          onToggleImagery={() => setShowImagery((v) => !v)}
          isProcessing={isProcessing}
          onUploadClick={() => document.querySelector('.sidebar input[type="file"]')?.click()}
          onProcessClick={handleProcess}
        />
      </main>

      <InfoPanel
        parcelCount={parcels.length}
        buildingCount={buildings.length}
        totalAreaM2={totalAreaM2}
        confidence={confidence}
        phase={proc.phase}
        stageLabel={proc.stageLabel}
        selected={selected}
        onClearSelection={() => setSelectedId(null)}
      />

      <BottomPanel
        progress={proc.progress}
        stageLabel={proc.stageLabel}
        phase={proc.phase}
        logs={proc.logs}
        onClearLogs={proc.clearLogs}
        onExportGeoJSON={() => exportGeoJSON(parcels, buildings, roads)}
        onStop={proc.stop}
        hasResults={parcels.length > 0}
      />

      <ReportsModal
        open={reportsOpen}
        onClose={() => setReportsOpen(false)}
        parcels={parcels}
        buildingCount={buildings.length}
        totalAreaM2={totalAreaM2}
        confidence={confidence}
        onExportCSV={() => exportCSV(parcels)}
        onExportGeoJSON={() => exportGeoJSON(parcels, buildings, roads)}
      />
    </div>
  )
}
