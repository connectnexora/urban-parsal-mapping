import { useCallback, useEffect, useRef, useState } from 'react'
import { BUILDINGS, PARCELS, ROADS } from '../data/sampleData'

// Local simulation of the AI detection pipeline.
// Everything runs in the browser with timers — no backend, no network.
// Swap `start()` internals with real model calls when the model is ready;
// the state shape (phase / progress / logs / revealed / confidence) stays the same.

const STAGE_LABELS = [
  'Preprocessing orthomosaic',
  'Detecting parcels',
  'Detecting buildings',
  'Detecting roads',
  'Finalizing vectors'
]
// Progress targets per stage index (index 5 = done).
const STAGE_TARGETS = [12, 32, 68, 88, 97, 100]

function timestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

let logSeq = 0
function makeLog(level, msg) {
  logSeq += 1
  return { id: logSeq, time: timestamp(), level, msg }
}

const initialState = {
  phase: 'idle', // idle | processing | done
  progress: 0,
  stageIndex: -1,
  logs: [],
  revealed: { parcels: 0, buildings: 0, roads: 0 },
  confidence: null
}

function runningConfidence(revealed) {
  const items = [
    ...PARCELS.slice(0, revealed.parcels),
    ...BUILDINGS.slice(0, revealed.buildings),
    ...ROADS.slice(0, revealed.roads)
  ]
  if (!items.length) return null
  return items.reduce((s, i) => s + i.confidence, 0) / items.length
}

export function useProcessing() {
  const [state, setState] = useState(initialState)
  const timers = useRef([])
  const progressTimer = useRef(null)
  const busyRef = useRef(false)

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (progressTimer.current) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
    }
  }

  useEffect(() => clearTimers, [])

  const later = (ms, fn) => {
    const id = setTimeout(fn, ms)
    timers.current.push(id)
  }

  const pushLog = useCallback((level, msg) => {
    setState((s) => ({ ...s, logs: [...s.logs.slice(-199), makeLog(level, msg)] }))
  }, [])

  const setRevealed = useCallback((patch) => {
    setState((s) => {
      const revealed = { ...s.revealed, ...patch }
      return { ...s, revealed, confidence: runningConfidence(revealed) }
    })
  }, [])

  const start = useCallback(
    (imageName) => {
      if (busyRef.current) return
      busyRef.current = true
      clearTimers()
      setState({
        ...initialState,
        phase: 'processing',
        progress: 1,
        stageIndex: 0,
        logs: [makeLog('info', `Pipeline started — source: ${imageName || 'built-in sample grid'}`)]
      })

      // Smooth progress animation toward the current stage target.
      const targetRef = { value: STAGE_TARGETS[0] }
      progressTimer.current = setInterval(() => {
        setState((s) => {
          if (s.phase !== 'processing') return s
          const next = s.progress + (targetRef.value - s.progress) * 0.08 + 0.25
          return { ...s, progress: Math.min(next, 99.2) }
        })
      }, 120)

      const setStage = (i, msg) => {
        targetRef.value = STAGE_TARGETS[i]
        setState((s) => ({ ...s, stageIndex: i }))
        if (msg) pushLog('info', msg)
      }

      let t = 500
      later(t, () => {
        pushLog('info', 'Orthomosaic validated locally (8192 × 5734 px, GSD 4.2 cm)')
      })
      t += 900
      later(t, () => pushLog('success', 'Preprocessing complete — contrast stretched, blur mask applied'))

      // Stage 1: parcels, one at a time.
      t += 500
      later(t, () => setStage(1, 'Parcel segmentation running (local weights v0.1)'))
      PARCELS.forEach((p, i) => {
        t += 480
        later(t, () => {
          setRevealed({ parcels: i + 1 })
          pushLog('success', `Detected ${p.id} · ${p.landUse} · conf ${(p.confidence * 100).toFixed(1)}%`)
        })
      })

      // Stage 2: buildings in batches.
      t += 500
      later(t, () => setStage(2, 'Building footprint extraction running'))
      const batchSize = 3
      for (let i = 0; i < BUILDINGS.length; i += batchSize) {
        const batch = BUILDINGS.slice(i, i + batchSize)
        t += 420
        const count = Math.min(i + batchSize, BUILDINGS.length)
        later(t, () => {
          setRevealed({ buildings: count })
          pushLog('info', `Footprints ${batch.map((b) => b.id).join(', ')} assigned to ${batch[0].parcelId}`)
        })
      }

      // Stage 3: roads.
      t += 500
      later(t, () => setStage(3, 'Road network tracing running'))
      ROADS.forEach((r, i) => {
        t += 380
        later(t, () => {
          setRevealed({ roads: i + 1 })
          pushLog('success', `Traced ${r.id} · ${r.name} · conf ${(r.confidence * 100).toFixed(1)}%`)
        })
      })

      // Stage 4: finalize.
      t += 600
      later(t, () => setStage(4, 'Vectorizing + computing parcel areas'))
      t += 900
      later(t, () => {
        if (progressTimer.current) {
          clearInterval(progressTimer.current)
          progressTimer.current = null
        }
        busyRef.current = false
        setState((s) => ({ ...s, phase: 'done', progress: 100, stageIndex: 5 }))
        pushLog(
          'success',
          `Done — ${PARCELS.length} parcels, ${BUILDINGS.length} buildings, ${ROADS.length} road segments`
        )
      })
    },
    [pushLog, setRevealed]
  )

  const stop = useCallback(() => {
    clearTimers()
    busyRef.current = false
    setState((s) =>
      s.phase === 'processing'
        ? { ...s, phase: 'idle', stageIndex: -1, logs: [...s.logs, makeLog('warn', 'Pipeline stopped by operator')] }
        : s
    )
  }, [])

  const reset = useCallback(() => {
    clearTimers()
    busyRef.current = false
    setState(initialState)
  }, [])

  const clearLogs = useCallback(() => {
    setState((s) => ({ ...s, logs: [] }))
  }, [])

  const stageLabel =
    state.phase === 'done'
      ? 'Complete'
      : state.stageIndex >= 0
        ? STAGE_LABELS[state.stageIndex]
        : 'Idle'

  return { ...state, stageLabel, STAGE_LABELS, start, stop, reset, clearLogs }
}
