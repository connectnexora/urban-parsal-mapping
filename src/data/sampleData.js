// Sample survey extent. All geometry lives in a local 1000 x 700 scene
// coordinate system — no external tiles or APIs required.
// Scale: 1 scene unit = 0.5 m on the ground.

export const WORLD = { w: 1000, h: 700 }
export const METERS_PER_UNIT = 0.5

export const PARCELS = [
  { id: 'P-01', landUse: 'Residential', confidence: 0.93, points: [[36, 36], [238, 36], [238, 316], [36, 316]] },
  { id: 'P-02', landUse: 'Residential', confidence: 0.91, points: [[250, 36], [456, 36], [456, 316], [250, 316]] },
  { id: 'P-03', landUse: 'Commercial', confidence: 0.89, points: [[504, 36], [730, 36], [730, 316], [504, 316]] },
  { id: 'P-04', landUse: 'Residential', confidence: 0.94, points: [[742, 36], [964, 36], [956, 190], [964, 316], [742, 316], [748, 180]] },
  { id: 'P-05', landUse: 'Agricultural', confidence: 0.88, points: [[36, 364], [238, 364], [238, 664], [36, 664]] },
  { id: 'P-06', landUse: 'Residential', confidence: 0.92, points: [[250, 364], [456, 364], [456, 664], [250, 664]] },
  { id: 'P-07', landUse: 'Industrial', confidence: 0.87, points: [[504, 364], [770, 364], [964, 382], [964, 508], [504, 508]] },
  { id: 'P-08', landUse: 'Agricultural', confidence: 0.9, points: [[504, 520], [964, 520], [964, 664], [504, 664]] }
]

export const BUILDINGS = [
  { id: 'B-01', parcelId: 'P-01', confidence: 0.95, points: [[80, 90], [170, 90], [170, 160], [80, 160]] },
  { id: 'B-02', parcelId: 'P-01', confidence: 0.9, points: [[90, 200], [150, 200], [150, 250], [90, 250]] },
  { id: 'B-03', parcelId: 'P-02', confidence: 0.93, points: [[290, 80], [400, 80], [400, 170], [290, 170]] },
  { id: 'B-04', parcelId: 'P-02', confidence: 0.88, points: [[300, 210], [360, 210], [360, 260], [300, 260]] },
  { id: 'B-05', parcelId: 'P-03', confidence: 0.91, points: [[540, 90], [690, 90], [690, 180], [540, 180]] },
  { id: 'B-06', parcelId: 'P-04', confidence: 0.94, points: [[780, 80], [900, 80], [900, 150], [780, 150]] },
  { id: 'B-07', parcelId: 'P-04', confidence: 0.89, points: [[790, 190], [860, 190], [860, 250], [790, 250]] },
  { id: 'B-08', parcelId: 'P-05', confidence: 0.86, points: [[70, 420], [180, 420], [180, 500], [70, 500]] },
  { id: 'B-09', parcelId: 'P-06', confidence: 0.92, points: [[290, 420], [400, 420], [400, 510], [290, 510]] },
  { id: 'B-10', parcelId: 'P-06', confidence: 0.87, points: [[300, 560], [370, 560], [370, 620], [300, 620]] },
  { id: 'B-11', parcelId: 'P-07', confidence: 0.9, points: [[560, 400], [760, 400], [760, 470], [560, 470]] },
  { id: 'B-12', parcelId: 'P-07', confidence: 0.88, points: [[800, 400], [920, 400], [920, 470], [800, 470]] },
  { id: 'B-13', parcelId: 'P-08', confidence: 0.85, points: [[580, 560], [700, 560], [700, 630], [580, 630]] },
  { id: 'B-14', parcelId: 'P-08', confidence: 0.89, points: [[760, 560], [880, 560], [880, 630], [760, 630]] }
]

export const ROADS = [
  { id: 'R-1', name: 'North–South Rd', confidence: 0.96, width: 36, points: [[480, 8], [480, 692]] },
  { id: 'R-2', name: 'East–West Rd', confidence: 0.95, width: 36, points: [[8, 340], [992, 340]] },
  { id: 'R-3', name: 'Service Lane', confidence: 0.9, width: 12, points: [[504, 514], [964, 514]] }
]
