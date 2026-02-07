import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { Dropzone } from './components/Dropzone'
import { PhotoGrid } from './components/PhotoGrid'
import { StepSelector, STEP_ORDER } from './components/StepSelector'
import { JobList } from './components/JobList'
import { BeforeAfter } from './components/BeforeAfter'
import { MaskEditor } from './components/MaskEditor'
import { CropEditor } from './components/CropEditor'
import { Tutorial } from './components/Tutorial'
import * as api from './api'
import type { Photo, Job, StepKey, StepInfo } from './types'

export function App() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [steps, setSteps] = useState<Record<string, StepInfo>>({})
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set())
  const [selectedSteps, setSelectedSteps] = useState<Set<StepKey>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [comparing, setComparing] = useState<Job | null>(null)
  const [device, setDevice] = useState<string>('cpu')
  const [modelChoices, setModelChoices] = useState<Record<string, string>>({})

  // Waiting job editing
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const dismissedJobsRef = useRef<Set<string>>(new Set())

  // Concurrency setting
  const [maxConcurrent, setMaxConcurrent] = useState(1)
  const [maxConcurrentLimit, setMaxConcurrentLimit] = useState(2)

  // Local files not yet uploaded (photo.id → File)
  const localFilesRef = useRef<Map<string, File>>(new Map())

  // Full-page drag & drop
  const [pageDrag, setPageDrag] = useState(false)
  const pageDragCountRef = useRef(0)

  // Auto-download completed jobs
  const [autoDownload, setAutoDownload] = useState(false)
  const downloadedJobsRef = useRef<Set<string>>(new Set())

  // Tutorial with demo data
  const [showTutorial, setShowTutorial] = useState(() => {
    try { return !localStorage.getItem('tutorial-seen') } catch { return true }
  })
  const demoIdsRef = useRef<{ photoId: string; jobIds: string[] }>({ photoId: '', jobIds: [] })

  const makeDemoPlaceholder = useCallback(() => {
    const c = document.createElement('canvas')
    c.width = 200; c.height = 150
    const ctx = c.getContext('2d')!
    // Sepia gradient background
    const g = ctx.createLinearGradient(0, 0, 200, 150)
    g.addColorStop(0, '#8B7355'); g.addColorStop(1, '#6B5B45')
    ctx.fillStyle = g; ctx.fillRect(0, 0, 200, 150)
    // Simple silhouette
    ctx.fillStyle = '#5C4E3C'
    ctx.beginPath(); ctx.arc(100, 55, 20, 0, Math.PI * 2); ctx.fill()
    ctx.fillRect(82, 75, 36, 45)
    // Label
    ctx.fillStyle = '#A0937D'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('Photo demo', 100, 140)
    return c.toDataURL('image/png')
  }, [])

  const injectDemoData = useCallback(() => {
    const demoPhotoId = '__demo_photo__'
    const demoJobId1 = '__demo_job_pending__'
    const demoJobId2 = '__demo_job_done__'
    const placeholder = makeDemoPlaceholder()
    demoIdsRef.current = { photoId: demoPhotoId, jobIds: [demoJobId1, demoJobId2] }

    const demoPhoto: Photo = {
      id: demoPhotoId,
      filename: '',
      originalName: 'vieille_photo_1953.jpg',
      uploadedAt: new Date().toISOString(),
    }
    // Override the thumbnail URL to be the data URL placeholder
    ;(demoPhoto as any)._thumbUrl = placeholder

    const demoJobPending: Job = {
      id: demoJobId1,
      photoId: demoPhotoId,
      photoName: 'vieille_photo_1953.jpg',
      original: placeholder,
      steps: ['scratch_removal', 'face_restore', 'colorize'] as StepKey[],
      status: 'pending',
      progress: 0,
      currentStep: null,
      createdAt: new Date().toISOString(),
      result: null,
      stepResults: [],
      priority: 999999,
    }

    const demoJobDone: Job = {
      id: demoJobId2,
      photoId: demoPhotoId,
      photoName: 'vieille_photo_1953.jpg',
      original: placeholder,
      steps: ['face_restore', 'colorize'] as StepKey[],
      status: 'completed',
      progress: 100,
      currentStep: null,
      createdAt: new Date().toISOString(),
      result: placeholder,
      stepResults: [
        { step: 'face_restore' as StepKey, result: placeholder },
        { step: 'colorize' as StepKey, result: placeholder },
      ],
    }

    setPhotos((prev) => [...prev, demoPhoto])
    setSelectedPhotos((prev) => { const n = new Set(prev); n.add(demoPhotoId); return n })
    setJobs((prev) => [demoJobDone, ...prev, demoJobPending])
  }, [makeDemoPlaceholder])

  const cleanupDemoData = useCallback(() => {
    const { photoId, jobIds } = demoIdsRef.current
    if (!photoId) return
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
    setSelectedPhotos((prev) => { const n = new Set(prev); n.delete(photoId); return n })
    setJobs((prev) => prev.filter((j) => !jobIds.includes(j.id)))
    demoIdsRef.current = { photoId: '', jobIds: [] }
  }, [])

  // Inject/remove demo data when tutorial opens/closes
  const prevShowTutorial = useRef(false)
  useEffect(() => {
    if (showTutorial && !prevShowTutorial.current) {
      // Small delay to let initial data load complete
      const t = setTimeout(injectDemoData, 300)
      prevShowTutorial.current = true
      return () => clearTimeout(t)
    }
    if (!showTutorial && prevShowTutorial.current) {
      prevShowTutorial.current = false
    }
  }, [showTutorial, injectDemoData])

  // Setup state (Docker: Python deps install in background)
  const [setupState, setSetupState] = useState<{
    ready: boolean, running: boolean, error: string | null,
    step: number, total: number, message: string
  }>({ ready: true, running: false, error: null, step: 0, total: 0, message: '' })

  // Persisted strokes per job (survives close/reopen of MaskEditor)
  const [savedStrokes, setSavedStrokes] = useState<Record<string, string>>({})

  // Load initial data
  useEffect(() => {
    api.getSteps().then((s) => {
      setSteps(s)
      const defaults: Record<string, string> = {}
      for (const [key, info] of Object.entries(s)) {
        if (info.defaultModel) defaults[key] = info.defaultModel
      }
      setModelChoices(defaults)
    })
    api.getPhotos().then((p) => setPhotos((prev) => {
      const demoPhotos = prev.filter((x) => x.id === demoIdsRef.current.photoId)
      return [...p, ...demoPhotos]
    }))
    api.getJobs().then((j) => setJobs((prev) => {
      const demoJobs = prev.filter((x) => demoIdsRef.current.jobIds.includes(x.id))
      return [...j, ...demoJobs]
    }))
    api.getSettings().then(s => {
      setMaxConcurrent(s.maxConcurrent)
      if (s.maxConcurrentLimit) setMaxConcurrentLimit(s.maxConcurrentLimit)
    })
    fetch('/api/status').then(r => r.json()).then(d => {
      setDevice(d.device || 'cpu')
      setSetupState({
          ready: d.aiReady, running: d.setupRunning, error: d.setupError || null,
          step: d.setupStatus?.step || 0, total: d.setupStatus?.total || 0,
          message: d.setupStatus?.message || ''
        })
    })
  }, [])

  // Poll setup status while installation is running or failed
  useEffect(() => {
    if (setupState.ready) return
    if (!setupState.running && !setupState.error) return
    const timer = setInterval(() => {
      fetch('/api/status').then(r => r.json()).then(d => {
        setSetupState({
          ready: d.aiReady, running: d.setupRunning, error: d.setupError || null,
          step: d.setupStatus?.step || 0, total: d.setupStatus?.total || 0,
          message: d.setupStatus?.message || ''
        })
        if (d.aiReady) setDevice(d.device || 'cpu')
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [setupState.ready, setupState.running, setupState.error])

  // Poll jobs while any are processing
  useEffect(() => {
    const demoIds = new Set(demoIdsRef.current.jobIds)
    const hasActive = jobs.some(
      (j) => !demoIds.has(j.id) && (j.status === 'pending' || j.status === 'processing' || j.status === 'waiting_input')
    )
    if (!hasActive) return

    const timer = setInterval(async () => {
      const updated = await api.getJobs()
      // Preserve demo jobs during polling
      setJobs((prev) => {
        const demoJobs = prev.filter((j) => demoIdsRef.current.jobIds.includes(j.id))
        return demoJobs.length > 0 ? [...updated, ...demoJobs] : updated
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [jobs])

  // Auto-remove photos when all their jobs are done
  useEffect(() => {
    const demoPhotoId = demoIdsRef.current.photoId
    // Build map: photoId → list of job statuses
    const photoJobs = new Map<string, string[]>()
    for (const job of jobs) {
      if (demoIdsRef.current.jobIds.includes(job.id)) continue
      const statuses = photoJobs.get(job.photoId) || []
      statuses.push(job.status)
      photoJobs.set(job.photoId, statuses)
    }
    const toRemove = new Set<string>()
    for (const [photoId, statuses] of photoJobs) {
      if (photoId === demoPhotoId) continue
      if (statuses.length > 0 && statuses.every(s => s === 'completed' || s === 'failed' || s === 'cancelled')) {
        toRemove.add(photoId)
      }
    }
    if (toRemove.size > 0) {
      setPhotos(prev => prev.filter(p => !toRemove.has(p.id)))
      setSelectedPhotos(prev => {
        const next = new Set(prev)
        for (const id of toRemove) next.delete(id)
        return next.size !== prev.size ? next : prev
      })
    }
  }, [jobs])

  // Auto-download completed jobs
  useEffect(() => {
    if (!autoDownload) return
    for (const job of jobs) {
      if (job.status === 'completed' && job.result && !downloadedJobsRef.current.has(job.id)) {
        downloadedJobsRef.current.add(job.id)
        const name = job.photoName.replace(/\.[^.]+$/, '')
        const a = document.createElement('a')
        a.href = job.result
        a.download = `${name}_final.jpg`
        a.click()
      }
    }
  }, [jobs, autoDownload])

  const handleUpload = useCallback((files: File[]) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp']
    const valid = files.filter(f => allowed.some(ext => f.name.toLowerCase().endsWith(ext)))
    if (!valid.length) return

    const newPhotos: Photo[] = valid.map(file => {
      const id = crypto.randomUUID()
      localFilesRef.current.set(id, file)
      return {
        id,
        filename: '',
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        _blobUrl: URL.createObjectURL(file),
      } as Photo & { _blobUrl: string }
    })
    setPhotos(prev => [...prev, ...newPhotos])
    setSelectedPhotos(prev => {
      const n = new Set(prev)
      for (const p of newPhotos) n.add(p.id)
      return n
    })
  }, [])

  // Full-page drag & drop detection
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      pageDragCountRef.current++
      if (pageDragCountRef.current === 1) setPageDrag(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      pageDragCountRef.current--
      if (pageDragCountRef.current <= 0) { pageDragCountRef.current = 0; setPageDrag(false) }
    }
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      pageDragCountRef.current = 0
      setPageDrag(false)
      const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'))
      if (files.length) handleUpload(files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleUpload])

  const togglePhoto = useCallback((id: string) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const deletePhoto = useCallback(async (id: string) => {
    if (localFilesRef.current.has(id)) {
      // Local photo — just clean up blob URL
      const photo = photos.find(p => p.id === id) as any
      if (photo?._blobUrl) URL.revokeObjectURL(photo._blobUrl)
      localFilesRef.current.delete(id)
    } else {
      await api.deletePhoto(id)
    }
    setPhotos(prev => prev.filter(p => p.id !== id))
    setSelectedPhotos(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [photos])

  const clearPhotos = useCallback(async () => {
    // Clean up blob URLs
    for (const photo of photos) {
      if ((photo as any)._blobUrl) URL.revokeObjectURL((photo as any)._blobUrl)
    }
    localFilesRef.current.clear()
    // Delete server-side photos too
    if (photos.some(p => p.filename)) await api.deleteAllPhotos()
    setPhotos([])
    setSelectedPhotos(new Set())
  }, [photos])

  const toggleStep = useCallback((step: StepKey) => {
    setSelectedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(step)) next.delete(step)
      else next.add(step)
      return next
    })
  }, [])

  const toggleAllSteps = useCallback(() => {
    setSelectedSteps((prev) => {
      const available = STEP_ORDER.filter(k => steps[k])
      const allSelected = available.every(k => prev.has(k))
      return allSelected ? new Set<StepKey>() : new Set<StepKey>(available)
    })
  }, [steps])

  const changeModel = useCallback((step: string, model: string) => {
    setModelChoices((prev) => ({ ...prev, [step]: model }))
  }, [])

  const selectAll = useCallback(() => {
    setSelectedPhotos((prev) => {
      if (prev.size === photos.length) return new Set()
      return new Set(photos.map((p) => p.id))
    })
  }, [photos])

  const launchJobs = useCallback(async () => {
    if (!selectedPhotos.size || !selectedSteps.size) return

    const options: Record<string, string> = {}
    for (const step of selectedSteps) {
      if (modelChoices[step]) options[step] = modelChoices[step]
    }

    const stepsToRun = STEP_ORDER.filter(s => selectedSteps.has(s))

    // Upload local photos first (in batches of 5)
    const localIds = [...selectedPhotos].filter(id => localFilesRef.current.has(id))
    const idMap = new Map<string, string>() // localId → serverId
    const BATCH = 5

    if (localIds.length > 0) {
      setUploading(true)
      try {
        for (let i = 0; i < localIds.length; i += BATCH) {
          const batch = localIds.slice(i, i + BATCH)
          const files = batch.map(id => localFilesRef.current.get(id)!)
          const uploaded = await api.uploadPhotos(files)
          batch.forEach((localId, idx) => {
            idMap.set(localId, uploaded[idx].id)
            // Clean up local state
            const oldPhoto = photos.find(p => p.id === localId) as any
            if (oldPhoto?._blobUrl) URL.revokeObjectURL(oldPhoto._blobUrl)
            localFilesRef.current.delete(localId)
          })
          // Update photos in state: replace local entries with server entries
          setPhotos(prev => prev.map(p => {
            const serverId = idMap.get(p.id)
            if (!serverId) return p
            const uploaded2 = uploaded.find(u => u.id === serverId)
            return uploaded2 || p
          }))
        }
      } finally {
        setUploading(false)
      }
    }

    // Map selected IDs to server IDs
    const photoIds = [...selectedPhotos].map(id => idMap.get(id) || id)

    const newJobs = await api.createJobs(photoIds, stepsToRun, options)
    setJobs(prev => [...newJobs, ...prev])
    setSelectedPhotos(new Set())
  }, [selectedPhotos, selectedSteps, modelChoices, photos])

  // --- Waiting job editor handlers ---

  const handleEdit = useCallback((jobId: string) => {
    dismissedJobsRef.current.delete(jobId)
    setEditingJobId(jobId)
  }, [])

  const handleWaitingCropApply = useCallback(async (cropRect: string) => {
    if (!editingJobId) return
    await api.submitJobInput(editingJobId, { cropRect })
    setEditingJobId(null)
  }, [editingJobId])

  const handleWaitingMaskApply = useCallback(async (maskDataUrl: string) => {
    if (!editingJobId) return
    await api.submitJobInput(editingJobId, { mask: maskDataUrl })
    setSavedStrokes((prev) => { const { [editingJobId]: _, ...rest } = prev; return rest })
    setEditingJobId(null)
  }, [editingJobId])

  const handleWaitingSkip = useCallback(async () => {
    if (!editingJobId) return
    await api.skipJobStep(editingJobId)
    setSavedStrokes((prev) => { const { [editingJobId]: _, ...rest } = prev; return rest })
    setEditingJobId(null)
  }, [editingJobId])

  const handleWaitingBack = useCallback(async () => {
    if (!editingJobId) return
    await api.jobGoBack(editingJobId)
    setSavedStrokes((prev) => { const { [editingJobId]: _, ...rest } = prev; return rest })
    // Don't close — the job will become waiting_input again on the previous step
    // The auto-open effect will re-open the editor
    setEditingJobId(null)
  }, [editingJobId])

  const handleEditorClose = useCallback(() => {
    if (editingJobId) {
      dismissedJobsRef.current.add(editingJobId)
    }
    setEditingJobId(null)
  }, [editingJobId])

  // Auto-open editor for waiting_input jobs
  useEffect(() => {
    if (editingJobId) return
    const waitingJob = jobs.find(
      (j) => j.status === 'waiting_input' && !dismissedJobsRef.current.has(j.id)
    )
    if (waitingJob) {
      setEditingJobId(waitingJob.id)
    }
  }, [jobs, editingJobId])

  const handleConcurrencyChange = useCallback(async (value: number) => {
    setMaxConcurrent(value)
    await api.updateSettings({ maxConcurrent: value })
  }, [])

  const handleReorder = useCallback(async (orderedPendingIds: string[]) => {
    // Optimistic: reorder local jobs
    setJobs((prev) => {
      const pendingMap = new Map(prev.filter(j => j.status === 'pending').map(j => [j.id, j]))
      const reordered = orderedPendingIds.map(id => pendingMap.get(id)!).filter(Boolean)
      const nonPending = prev.filter(j => j.status !== 'pending')
      // Keep waiting/processing first, then reordered pending, then completed/failed
      const active = nonPending.filter(j => j.status === 'waiting_input' || j.status === 'processing')
      const done = nonPending.filter(j => j.status === 'completed' || j.status === 'failed')
      return [...active, ...reordered, ...done]
    })
    await api.reorderJobs(orderedPendingIds)
  }, [])

  const handleImport = useCallback(async (resultPath: string) => {
    const photo = await api.importResult(resultPath)
    setPhotos((prev) => [...prev, photo])
  }, [])

  const handleSaveStrokes = useCallback((jobId: string, dataUrl: string) => {
    setSavedStrokes((prev) => {
      if (!dataUrl) {
        const { [jobId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [jobId]: dataUrl }
    })
  }, [])

  const canLaunch = selectedPhotos.size > 0 && selectedSteps.size > 0
  const activeJobs = jobs.filter(j => j.status === 'processing' || j.status === 'pending' || j.status === 'waiting_input').length
  const editingJob = editingJobId ? jobs.find(j => j.id === editingJobId) : null

  return (
    <div class="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Setup error banner */}
      {!setupState.ready && !setupState.running && setupState.error && (
        <div class="flex-shrink-0 bg-red-500/10 border-b border-red-500/30 px-5 py-2.5 flex items-center gap-3">
          <svg class="w-4 h-4 text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
          <span class="text-sm text-red-300">
            {setupState.error}
          </span>
        </div>
      )}
      {/* Setup progress banner */}
      {!setupState.ready && setupState.running && (
        <div class="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-5 py-2.5 space-y-1.5">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span class="text-sm text-amber-300">
              Installation des dépendances IA
              {setupState.total > 0 && <span class="text-amber-400 font-medium ml-1">({setupState.step}/{setupState.total})</span>}
            </span>
          </div>
          {setupState.message && (
            <div class="ml-7 text-xs text-amber-400/70">{setupState.message}</div>
          )}
          {setupState.total > 0 && (
            <div class="ml-7 h-1 rounded-full bg-amber-900/40 overflow-hidden" style={{ maxWidth: '300px' }}>
              <div
                class="h-full bg-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.round((setupState.step / setupState.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
      {/* Header */}
      <header class="flex-shrink-0 border-b border-zinc-800 px-5 py-3 flex items-center justify-between">
        <div>
          <h1 class="text-lg font-bold text-zinc-100">Old Photos Restorer</h1>
          <p class="text-xs text-zinc-500">Restaurez vos vieilles photos avec l'IA</p>
        </div>
        <div class="flex items-center gap-3">
          {activeJobs > 0 && (
            <span class="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-300 animate-pulse">
              {activeJobs} job{activeJobs > 1 ? 's' : ''} en cours
            </span>
          )}
          <span class="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase tracking-wider">
            {device === 'mps' ? 'GPU Metal' : device === 'cuda' ? 'GPU CUDA' : 'CPU'}
          </span>
          <button
            onClick={() => setShowTutorial(true)}
            class="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-amber-400 text-sm font-medium transition-colors flex items-center justify-center"
            title="Tutoriel"
          >
            ?
          </button>
        </div>
      </header>

      {/* Main 3-column layout */}
      <div class="flex-1 flex overflow-hidden">

        {/* LEFT: Photos */}
        <div class="flex-1 min-w-0 border-r border-zinc-800 flex flex-col">
          <div class="p-3 border-b border-zinc-800 flex items-center justify-between">
            <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Photos ({photos.length})
            </h2>
            {photos.length > 0 && (
              <div class="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  class="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {selectedPhotos.size === photos.length ? 'Désélectionner' : 'Tout sélectionner'}
                </button>
                <button
                  onClick={clearPhotos}
                  class="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                >
                  Vider
                </button>
              </div>
            )}
          </div>

          <div class="flex-1 overflow-y-auto p-3 space-y-3">
            <div data-tour="dropzone">
              <Dropzone onFiles={handleUpload} />
            </div>
            {uploading && (
              <p class="text-xs text-zinc-400 animate-pulse text-center">Upload en cours...</p>
            )}
            <div data-tour="photo-grid">
              <PhotoGrid
                photos={photos}
                selected={selectedPhotos}
                onToggle={togglePhoto}
                onDelete={deletePhoto}
              />
            </div>
          </div>
        </div>

        {/* CENTER: Steps & Launch */}
        <div class="w-full max-w-[350px] flex-shrink-0 flex flex-col items-center justify-start overflow-auto p-6">
          <div class="w-full space-y-5">
            <div data-tour="steps">
              <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">
                Étapes de restauration
              </h2>
              {Object.keys(steps).length > 0 && (
                <StepSelector
                  steps={steps}
                  selected={selectedSteps}
                  onToggle={toggleStep}
                  onToggleAll={toggleAllSteps}
                  modelChoices={modelChoices}
                  onModelChange={changeModel}
                />
              )}
            </div>

            {/* Selected summary */}
            <div class="text-center text-xs text-zinc-500">
              {selectedPhotos.size > 0 ? (
                <span>{selectedPhotos.size} photo{selectedPhotos.size > 1 ? 's' : ''} sélectionnée{selectedPhotos.size > 1 ? 's' : ''}</span>
              ) : (
                <span>Sélectionnez des photos à gauche</span>
              )}
              {selectedSteps.size > 0 && (
                <span class="block mt-0.5 text-amber-400/60">
                  {STEP_ORDER.filter(s => selectedSteps.has(s)).map(s => steps[s]?.name).filter(Boolean).join(' → ')}
                </span>
              )}
            </div>

            {/* Launch */}
            <button
              data-tour="launch"
              onClick={launchJobs}
              disabled={!canLaunch}
              class={`
                w-full py-3 rounded-lg font-medium text-sm transition-all
                ${
                  canLaunch
                    ? 'bg-amber-500 hover:bg-amber-400 text-zinc-900 cursor-pointer shadow-lg shadow-amber-500/20'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }
              `}
            >
              {canLaunch
                ? `Lancer ${selectedPhotos.size} job${selectedPhotos.size > 1 ? 's' : ''}`
                : 'Sélectionnez photos + étapes'}
            </button>

            {/* Auto-download toggle */}
            <label data-tour="auto-download" class="flex items-center gap-2 cursor-pointer justify-center">
              <input
                type="checkbox"
                checked={autoDownload}
                onChange={(e) => setAutoDownload((e.target as HTMLInputElement).checked)}
                class="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500/30 cursor-pointer accent-amber-500"
              />
              <span class="text-[11px] text-zinc-500">Télécharger auto les résultats</span>
            </label>
          </div>
        </div>

        {/* RIGHT: Jobs */}
        <div class="w-full max-w-[450px] flex-shrink-0 border-l border-zinc-800 flex flex-col">
          <div data-tour="jobs-header" class="p-3 border-b border-zinc-800 space-y-2">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Jobs ({jobs.length})
              </h2>
              <div class="flex items-center gap-3">
                {jobs.some(j => j.status === 'processing' || j.status === 'pending' || j.status === 'waiting_input') && (
                  <button
                    onClick={async () => { await api.cancelAllJobs(); api.getJobs().then(setJobs) }}
                    class="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    Tout arrêter
                  </button>
                )}
                {jobs.some(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') && (
                  <button
                    onClick={() => setJobs(prev => prev.filter(j => j.status === 'processing' || j.status === 'pending' || j.status === 'waiting_input'))}
                    class="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Vider terminés
                  </button>
                )}
              </div>
            </div>
            <div data-tour="concurrency" class="flex items-center gap-2">
              <span class="text-[10px] text-zinc-500 whitespace-nowrap">Parallèle</span>
              <input
                type="range"
                min="1"
                max={maxConcurrentLimit}
                value={maxConcurrent}
                onInput={(e) => handleConcurrencyChange(Number((e.target as HTMLInputElement).value))}
                class="flex-1 h-1 accent-amber-500 cursor-pointer"
              />
              <span class="text-[10px] text-zinc-400 w-3 text-center">{maxConcurrent}</span>
            </div>
          </div>
          <div data-tour="jobs-list" class="flex-1 overflow-y-auto p-3">
            <JobList jobs={jobs} steps={steps} onCompare={setComparing} onImport={handleImport} onReorder={handleReorder} onEdit={handleEdit} />
          </div>
        </div>
      </div>

      {/* Before/After overlay */}
      {comparing && comparing.result && (
        <BeforeAfter
          original={comparing.original}
          result={comparing.result}
          label={comparing.photoName}
          onClose={() => setComparing(null)}
        />
      )}

      {/* Crop editor overlay (waiting_input) */}
      {editingJob && editingJob.status === 'waiting_input' && editingJob.waitingStep === 'crop' && editingJob.waitingImage && (
        <CropEditor
          imageUrl={editingJob.waitingImage}
          photoLabel={editingJob.photoName}
          onApply={handleWaitingCropApply}
          onSkip={handleWaitingSkip}
          onBack={handleWaitingBack}
          canGoBack={editingJob.canGoBack}
          onClose={handleEditorClose}
        />
      )}

      {/* Mask editor overlay (waiting_input) */}
      {editingJob && editingJob.status === 'waiting_input' && editingJob.waitingStep === 'inpaint' && editingJob.waitingImage && (
        <MaskEditor
          imageUrl={editingJob.waitingImage}
          photoLabel={editingJob.photoName}
          savedStrokes={savedStrokes[editingJob.id]}
          onApply={handleWaitingMaskApply}
          onSkip={handleWaitingSkip}
          onBack={handleWaitingBack}
          canGoBack={editingJob.canGoBack}
          onSaveStrokes={(dataUrl) => handleSaveStrokes(editingJob.id, dataUrl)}
          onClose={handleEditorClose}
        />
      )}

      {/* Interactive tutorial */}
      {showTutorial && (
        <Tutorial
          onClose={() => {
            cleanupDemoData()
            setShowTutorial(false)
            try { localStorage.setItem('tutorial-seen', '1') } catch {}
          }}
        />
      )}

      {/* Full-page drag overlay */}
      {pageDrag && (
        <div class="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center pointer-events-none">
          <div class="border-2 border-dashed border-amber-400 rounded-2xl px-16 py-12 bg-amber-400/10">
            <p class="text-amber-300 text-lg font-medium">Lâchez vos photos ici</p>
            <p class="text-amber-400/50 text-sm mt-1 text-center">JPG, PNG, WebP, TIFF, BMP</p>
          </div>
        </div>
      )}
    </div>
  )
}
