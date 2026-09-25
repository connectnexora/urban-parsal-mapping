import { useRef } from 'react'

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function ProcessIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
function ParcelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}
function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 20V8l7-4 7 4v12M5 20h14M9 20v-5h6v5M9 11h.01M15 11h.01M12 11h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function RoadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 20L10 4M18 20L14 4M12 6v2M12 11v2M12 16v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Sidebar({
  open,
  layers,
  counts,
  hasImage,
  imageName,
  isProcessing,
  canProcess,
  onUpload,
  onProcess,
  onToggleLayer,
  onOpenReports
}) {
  const fileRef = useRef(null)

  const pickFile = () => fileRef.current?.click()

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  const items = [
    {
      key: 'upload',
      label: 'Upload Drone Image',
      sub: hasImage ? imageName : 'GeoTIFF / JPG / PNG',
      icon: <UploadIcon />,
      active: hasImage,
      badge: null,
      onClick: pickFile
    },
    {
      key: 'process',
      label: 'Process Image',
      sub: isProcessing ? 'Running…' : canProcess ? 'Ready to run' : 'Awaiting input',
      icon: <ProcessIcon />,
      active: false,
      badge: null,
      disabled: isProcessing,
      onClick: onProcess
    },
    {
      key: 'parcels',
      label: 'Parcel Detection',
      sub: `${counts.parcels} detected`,
      icon: <ParcelIcon />,
      active: layers.parcels,
      badge: counts.parcels,
      onClick: () => onToggleLayer('parcels')
    },
    {
      key: 'buildings',
      label: 'Building Detection',
      sub: `${counts.buildings} detected`,
      icon: <BuildingIcon />,
      active: layers.buildings,
      badge: counts.buildings,
      onClick: () => onToggleLayer('buildings')
    },
    {
      key: 'roads',
      label: 'Road Detection',
      sub: `${counts.roads} detected`,
      icon: <RoadIcon />,
      active: layers.roads,
      badge: counts.roads,
      onClick: () => onToggleLayer('roads')
    },
    {
      key: 'reports',
      label: 'Reports',
      sub: 'Summary + export',
      icon: <ReportIcon />,
      active: false,
      badge: null,
      onClick: onOpenReports
    }
  ]

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} aria-label="Upload drone image" />
      <nav className="side-nav" aria-label="GIS tools">
        {items.map((item) => (
          <button
            key={item.key}
            className={`side-item ${item.active ? 'active' : ''}`}
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.sub}
          >
            <span className="side-icon">{item.icon}</span>
            <span className="side-text">
              <span className="side-label">{item.label}</span>
              <span className="side-sub">{item.sub}</span>
            </span>
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span className="side-badge">{item.badge}</span>
            )}
            {item.key === 'upload' && hasImage && <span className="side-check" aria-label="Image loaded">●</span>}
          </button>
        ))}
      </nav>
      <div className="model-card">
        <p className="model-title">Segmentation model</p>
        <p className="model-status">{isProcessing ? 'Inference running…' : 'Not connected · plug-in ready'}</p>
        <p className="model-sub">Backend: local simulation. UI contracts are model-agnostic.</p>
      </div>
    </aside>
  )
}
