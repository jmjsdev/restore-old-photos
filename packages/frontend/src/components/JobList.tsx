import { useState, useEffect, useRef } from 'preact/hooks'
import * as api from '../api'
import type { Job, StepInfo, StepKey } from '../types'

interface Props {
  jobs: Job[]
  steps: Record<string, StepInfo>
  onCompare: (job: Job) => void
  onImport: (resultPath: string) => void
  onReorder?: (orderedPendingIds: string[]) => void
  onEdit?: (jobId: string) => void
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'text-zinc-400 bg-zinc-800',
  processing: 'text-blue-300 bg-blue-500/20',
  waiting_input: 'text-orange-300 bg-orange-500/20',
  completed: 'text-emerald-300 bg-emerald-500/20',
  failed: 'text-red-300 bg-red-500/20',
  cancelled: 'text-zinc-400 bg-zinc-700/50',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'File d\'attente',
  processing: 'En cours',
  waiting_input: 'Action requise',
  completed: 'Terminé',
  failed: 'Erreur',
  cancelled: 'Annulé',
}

const STEP_ICONS: Record<string, string> = {
  crop: '\u{2702}',
  inpaint: '\u{1F9F9}',
  spot_removal: '\u{2728}',
  scratch_removal: '\u{1FA79}',
  face_restore: '\u{1F464}',
  colorize: '\u{1F3A8}',
  upscale: '\u{1F50D}',
}

interface ViewerImage { src: string; label: string }

type DownloadFormat = 'jpg' | 'png' | 'webp'
const FORMATS: { value: DownloadFormat; label: string; mime: string }[] = [
  { value: 'jpg', label: 'JPG', mime: 'image/jpeg' },
  { value: 'png', label: 'PNG', mime: 'image/png' },
  { value: 'webp', label: 'WebP', mime: 'image/webp' },
]

function downloadImage(src: string, baseName: string, format: DownloadFormat) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const fmt = FORMATS.find((f) => f.value === format)!
    const quality = format === 'png' ? undefined : 0.92
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    }, fmt.mime, quality)
  }
  img.src = src
}

function FullscreenViewer({ images, index, onNavigate, onClose, onImport }: {
  images: ViewerImage[]
  index: number
  onNavigate: (index: number) => void
  onClose: () => void
  onImport?: (src: string) => void
}) {
  const hasPrev = index > 0
  const hasNext = index < images.length - 1
  const current = images[index]
  const [dlFormat, setDlFormat] = useState<DownloadFormat>('jpg')
  const [showFormats, setShowFormats] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panningRef = useRef(false)
  const lastPanRef = useRef({ x: 0, y: 0 })
  const imgContainerRef = useRef<HTMLDivElement>(null)

  // Reset zoom/pan when navigating images
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [index])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showFormats) setShowFormats(false)
        else if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }) }
        else onClose()
      }
      else if (e.key === 'ArrowLeft' && hasPrev) onNavigate(index - 1)
      else if (e.key === 'ArrowRight' && hasNext) onNavigate(index + 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onNavigate, index, hasPrev, hasNext, showFormats, zoom])

  // Zoom with mouse wheel
  useEffect(() => {
    const el = imgContainerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -0.2 : 0.2
      setZoom((z) => {
        const newZ = Math.min(Math.max(z + delta, 1), 8)
        if (newZ <= 1) setPan({ x: 0, y: 0 })
        return newZ
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const onImgPointerDown = (e: PointerEvent) => {
    e.stopPropagation()
    if (zoom <= 1) return
    panningRef.current = true
    lastPanRef.current = { x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onImgPointerMove = (e: PointerEvent) => {
    if (!panningRef.current) return
    const dx = e.clientX - lastPanRef.current.x
    const dy = e.clientY - lastPanRef.current.y
    lastPanRef.current = { x: e.clientX, y: e.clientY }
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
  }

  const onImgPointerUp = () => {
    panningRef.current = false
  }

  const onImgDoubleClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }) }
    else setZoom(3)
  }

  const baseName = current.label.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F ]/g, '').replace(/\s+/g, '_')

  return (
    <div
      class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        class="absolute top-4 right-4 text-white/60 hover:text-white text-2xl z-10"
      >
        &times;
      </button>

      {/* Label + counter */}
      <div class="absolute top-4 left-4 text-white/60 text-sm z-10">
        {current.label}
        <span class="ml-2 text-white/30">{index + 1}/{images.length}</span>
        {zoom > 1 && <span class="ml-2 text-white/30">{Math.round(zoom * 100)}%</span>}
      </div>

      {/* Download button with format picker + import — top center */}
      <div
        class="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="flex items-center gap-0">
          <button
            onClick={() => downloadImage(current.src, baseName, dlFormat)}
            class="text-xs px-3 py-1.5 rounded-l-lg bg-white/15 hover:bg-white/25 text-white/80 hover:text-white transition-colors"
          >
            Télécharger .{dlFormat}
          </button>
          <div class="relative">
            <button
              onClick={() => setShowFormats(!showFormats)}
              class="text-xs px-2 py-1.5 rounded-r-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors border-l border-white/10"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            {showFormats && (
              <div class="absolute top-full right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden shadow-xl">
                {FORMATS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => { setDlFormat(f.value); setShowFormats(false) }}
                    class={`block w-full text-left text-xs px-4 py-2 hover:bg-zinc-700 transition-colors ${
                      dlFormat === f.value ? 'text-amber-400' : 'text-zinc-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {onImport && (current.src.startsWith('/results/') || current.src.startsWith('/uploads/')) && (
          <button
            onClick={() => onImport(current.src)}
            class="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 transition-colors"
          >
            Remettre dans la liste
          </button>
        )}
      </div>

      {/* Left arrow */}
      {hasPrev && (
        <button
          onClick={(e: MouseEvent) => { e.stopPropagation(); onNavigate(index - 1) }}
          class="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors z-10"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      )}

      {/* Right arrow */}
      {hasNext && (
        <button
          onClick={(e: MouseEvent) => { e.stopPropagation(); onNavigate(index + 1) }}
          class="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors z-10"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 4l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      )}

      {/* Image with zoom/pan */}
      <div
        ref={imgContainerRef}
        class="overflow-hidden max-w-[90vw] max-h-[90vh]"
        style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <img
          src={current.src}
          alt={current.label}
          class="max-w-[90vw] max-h-[90vh] object-contain select-none"
          draggable={false}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'center center',
          }}
          onPointerDown={onImgPointerDown}
          onPointerMove={onImgPointerMove}
          onPointerUp={onImgPointerUp}
          onDblClick={onImgDoubleClick}
        />
      </div>

      {/* Bottom thumbnails strip */}
      {images.length > 1 && (
        <div
          class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/60 rounded-lg p-1.5 z-10"
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => onNavigate(i)}
              class={`w-12 h-12 rounded overflow-hidden border-2 transition-all flex-shrink-0 ${
                i === index ? 'border-amber-400 opacity-100' : 'border-transparent opacity-50 hover:opacity-80'
              }`}
            >
              <img src={img.src} alt={img.label} class="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StepThumbnail({
  src,
  label,
  icon,
  active,
  done,
  error,
  onClick,
  onImport,
}: {
  src?: string
  label: string
  icon: string
  active?: boolean
  done?: boolean
  error?: boolean
  onClick?: () => void
  onImport?: () => void
}) {
  return (
    <div class="flex-shrink-0 flex flex-col items-center gap-1 w-16" data-active={active || undefined}>
      <div
        class={`
          relative w-14 h-14 rounded-lg overflow-hidden border
          ${error ? 'border-red-500 ring-1 ring-red-500/50' : active ? 'border-blue-400 ring-1 ring-blue-400/50' : done ? 'border-zinc-600' : 'border-zinc-700/50'}
          ${src ? 'cursor-pointer group' : ''}
          bg-zinc-800
        `}
        onClick={onClick}
      >
        {src ? (
          <>
            <img src={src} alt={label} class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200" />
            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
          </>
        ) : error ? (
          <div class="w-full h-full flex items-center justify-center text-red-400 text-lg">
            ✕
          </div>
        ) : active ? (
          <div class="w-full h-full flex items-center justify-center">
            <div class="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div class="w-full h-full flex items-center justify-center text-zinc-600 text-lg">
            {icon}
          </div>
        )}
      </div>
      <span class={`text-[9px] text-center leading-tight truncate w-full ${error ? 'text-red-400' : active ? 'text-blue-400' : 'text-zinc-500'}`}>
        {label}
      </span>
      {onImport && src && (
        <button
          onClick={(e: MouseEvent) => { e.stopPropagation(); onImport() }}
          class="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700/80 text-zinc-400 hover:bg-amber-500/30 hover:text-amber-300 transition-colors"
          title="Ajouter aux photos"
        >
          + Photo
        </button>
      )}
    </div>
  )
}

function ScrollableStepGallery({ job, steps, onViewerOpen, onImport }: {
  job: Job
  steps: Record<string, StepInfo>
  onViewerOpen: (src: string) => void
  onImport: (resultPath: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevStepRef = useRef<string | null>(null)

  const stepResults = job.stepResults || []
  const completedSteps = new Set(stepResults.map((sr) => sr.step))
  const resultMap = Object.fromEntries(stepResults.map((sr) => [sr.step, sr.result]))

  // Auto-scroll to active step when currentStep changes
  useEffect(() => {
    if (job.currentStep && job.currentStep !== prevStepRef.current) {
      prevStepRef.current = job.currentStep
      const el = containerRef.current?.querySelector('[data-active]')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }
    if (!job.currentStep) prevStepRef.current = null
  }, [job.currentStep])

  return (
    <div ref={containerRef} class="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
      <StepThumbnail
        src={job.original}
        label="Original"
        icon=""
        done
        onClick={() => onViewerOpen(job.original)}
        onImport={() => onImport(job.original)}
      />
      <div class="flex-shrink-0 flex items-center text-zinc-600 text-xs px-0.5 self-start mt-5">&#x2192;</div>
      {job.steps.map((step, idx) => {
        const isDone = completedSteps.has(step)
        const isActive = job.currentStep === step
        const isFailed = job.status === 'failed' && job.failedStep === step
        const src = resultMap[step]
        const stepName = steps[step]?.name || step
        const icon = STEP_ICONS[step] || ''
        return (
          <>
            {idx > 0 && (
              <div class="flex-shrink-0 flex items-center text-zinc-600 text-xs px-0.5 self-start mt-5">&#x2192;</div>
            )}
            <StepThumbnail
              key={`${job.id}-${step}`}
              src={isDone ? src : undefined}
              label={stepName}
              icon={icon}
              active={isActive}
              done={isDone}
              error={isFailed}
              onClick={isDone && src ? () => onViewerOpen(src) : undefined}
              onImport={isDone && src ? () => onImport(src) : undefined}
            />
          </>
        )
      })}
    </div>
  )
}

function FailedActions({ job, steps }: { job: Job; steps: Record<string, StepInfo> }) {
  const [showModels, setShowModels] = useState(false)
  const failedStepInfo = job.failedStep ? steps[job.failedStep] : null
  const hasModels = failedStepInfo?.models && Object.keys(failedStepInfo.models).length > 1

  const handleRetry = async () => {
    await api.retryJob(job.id)
  }

  const handleRetryWithModel = async (model: string) => {
    setShowModels(false)
    await api.retryJob(job.id, model)
  }

  const handleSkip = async () => {
    await api.skipFailedStep(job.id)
  }

  return (
    <div class="space-y-1.5">
      <p class="text-[10px] text-red-400/70 truncate" title={job.error || undefined}>
        {job.error || 'Erreur inconnue'}
      </p>
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={handleRetry}
          class="text-[10px] px-2 py-1 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
        >
          Relancer
        </button>
        {hasModels && (
          <div class="relative">
            <button
              onClick={() => setShowModels(!showModels)}
              class="text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              Changer de modèle ▾
            </button>
            {showModels && (
              <div class="absolute bottom-full left-0 mb-1 bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden shadow-xl z-10 min-w-[160px]">
                {Object.entries(failedStepInfo!.models!).map(([key, variant]) => (
                  <button
                    key={key}
                    onClick={() => handleRetryWithModel(key)}
                    class="block w-full text-left text-[10px] px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 transition-colors"
                  >
                    <span class="font-medium">{variant.name}</span>
                    <span class="text-zinc-500 ml-1">— {variant.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          onClick={handleSkip}
          class="text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
        >
          Passer l'étape
        </button>
      </div>
    </div>
  )
}

// Grip handle icon for drag
function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" class="text-zinc-600 group-hover:text-zinc-400 transition-colors">
      <circle cx="4" cy="2.5" r="1" /><circle cx="8" cy="2.5" r="1" />
      <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
      <circle cx="4" cy="9.5" r="1" /><circle cx="8" cy="9.5" r="1" />
    </svg>
  )
}

export function JobList({ jobs, steps, onCompare, onImport, onReorder, onEdit }: Props) {
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  if (!jobs.length) {
    return (
      <div class="flex flex-col items-center justify-center h-full text-zinc-600">
        <p class="text-sm">Aucun job</p>
        <p class="text-xs mt-1">Les jobs apparaîtront ici</p>
      </div>
    )
  }

  // Group jobs by status
  const waiting = jobs.filter((j) => j.status === 'waiting_input')
  const processing = jobs.filter((j) => j.status === 'processing')
  const pending = jobs.filter((j) => j.status === 'pending')
  const done = jobs.filter((j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled')

  const handleDragStart = (e: DragEvent, jobId: string) => {
    setDragId(jobId)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', jobId)
    }
  }

  const handleDragOver = (e: DragEvent, jobId: string) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (jobId !== dragId) setDropTarget(jobId)
  }

  const handleDragLeave = () => {
    setDropTarget(null)
  }

  const handleDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault()
    setDropTarget(null)
    if (!dragId || dragId === targetId) { setDragId(null); return }

    const ids = pending.map((j) => j.id)
    const fromIdx = ids.indexOf(dragId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); return }

    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, dragId)
    setDragId(null)
    onReorder?.(ids)
  }

  const handleDragEnd = () => {
    setDragId(null)
    setDropTarget(null)
  }

  const renderJobCard = (job: Job, opts: { draggable?: boolean } = {}) => {
    const stepResults = job.stepResults || []
    const galleryImages: ViewerImage[] = [
      { src: job.original, label: `${job.photoName} — Original` },
      ...stepResults.map((sr) => ({
        src: sr.result,
        label: `${job.photoName} — ${steps[sr.step]?.name || sr.step}`,
      })),
    ]

    const openViewer = (src: string) => {
      const idx = galleryImages.findIndex((img) => img.src === src)
      setViewer({ images: galleryImages, index: idx >= 0 ? idx : 0 })
    }

    const isDragging = dragId === job.id
    const isDropTarget = dropTarget === job.id

    return (
      <div
        key={job.id}
        class={`bg-zinc-900/80 border rounded-lg p-3 space-y-2 transition-all ${
          isDragging ? 'opacity-40 border-zinc-700' : isDropTarget ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-zinc-800'
        } ${opts.draggable ? 'group' : ''}`}
        draggable={opts.draggable}
        onDragStart={opts.draggable ? (e: DragEvent) => handleDragStart(e, job.id) : undefined}
        onDragOver={opts.draggable ? (e: DragEvent) => handleDragOver(e, job.id) : undefined}
        onDragLeave={opts.draggable ? handleDragLeave : undefined}
        onDrop={opts.draggable ? (e: DragEvent) => handleDrop(e, job.id) : undefined}
        onDragEnd={opts.draggable ? handleDragEnd : undefined}
      >
        {/* Top row: grip + status + name */}
        <div class="flex items-center gap-2">
          {opts.draggable && (
            <div class="flex-shrink-0 cursor-grab active:cursor-grabbing">
              <GripIcon />
            </div>
          )}
          <span
            class={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_STYLES[job.status]}`}
          >
            {STATUS_LABELS[job.status]}
          </span>
          <p class="text-sm text-zinc-200 truncate flex-1">{job.photoName}</p>
          {(job.status === 'pending' || job.status === 'processing' || job.status === 'waiting_input') && (
            <button
              onClick={() => api.cancelJob(job.id)}
              class="flex-shrink-0 text-zinc-600 hover:text-red-400 transition-colors"
              title="Annuler"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
            </button>
          )}
        </div>

        {/* Step gallery with auto-scroll */}
        {(job.status === 'processing' || job.status === 'completed' || job.status === 'waiting_input' || job.status === 'failed' || job.status === 'cancelled') && (
          <ScrollableStepGallery
            job={job}
            steps={steps}
            onViewerOpen={openViewer}
            onImport={onImport}
          />
        )}

        {/* Edit button for waiting_input */}
        {job.status === 'waiting_input' && onEdit && (
          <button
            onClick={() => onEdit(job.id)}
            class="text-xs px-3 py-1.5 rounded bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 transition-colors font-medium"
          >
            Éditer — {steps[job.waitingStep!]?.name || job.waitingStep}
          </button>
        )}

        {/* Progress bar for processing */}
        {job.status === 'processing' && (
          <div>
            <div class="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-blue-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(job.progress, 5)}%` }}
              />
            </div>
          </div>
        )}

        {/* Pending: just show step names */}
        {job.status === 'pending' && (
          <p class="text-[11px] text-zinc-500">
            {job.steps.map((s) => steps[s]?.name || s).join(' \u2192 ')}
          </p>
        )}

        {/* Completed actions */}
        {job.status === 'completed' && job.result && (
          <div class="flex gap-2 pt-1">
            <button
              onClick={() => onCompare(job)}
              class="text-xs px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
            >
              Comparer avant/après
            </button>
            <button
              onClick={() => {
                const name = job.photoName.replace(/\.[^.]+$/, '')
                downloadImage(job.result!, name + '_final', 'jpg')
              }}
              class="text-xs px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Télécharger JPG
            </button>
          </div>
        )}

        {/* Error with retry/skip actions */}
        {job.status === 'failed' && (
          <FailedActions job={job} steps={steps} />
        )}
      </div>
    )
  }

  return (
    <>
      <div class="space-y-2">
        {/* Waiting for input (top priority) */}
        {waiting.map((job) => renderJobCard(job))}

        {/* Processing jobs */}
        {processing.length > 0 && waiting.length > 0 && (
          <div class="border-t border-zinc-800 pt-2 mt-2" />
        )}
        {processing.map((job) => renderJobCard(job))}

        {/* Pending jobs (draggable) */}
        {pending.length > 0 && (processing.length > 0 || waiting.length > 0) && (
          <div class="border-t border-zinc-800 pt-2 mt-2" />
        )}
        {pending.map((job) => renderJobCard(job, { draggable: true }))}

        {/* Completed/failed jobs */}
        {done.length > 0 && (processing.length > 0 || pending.length > 0 || waiting.length > 0) && (
          <div class="border-t border-zinc-800 pt-2 mt-2" />
        )}
        {done.map((job) => renderJobCard(job))}
      </div>

      {/* Fullscreen viewer */}
      {viewer && (
        <FullscreenViewer
          images={viewer.images}
          index={viewer.index}
          onNavigate={(i) => setViewer({ ...viewer, index: i })}
          onClose={() => setViewer(null)}
          onImport={onImport}
        />
      )}
    </>
  )
}
