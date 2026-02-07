import { useState, useRef, useEffect, useCallback } from 'preact/hooks'

type Tool = 'brush' | 'eraser'

interface Props {
  imageUrl: string
  photoLabel?: string
  queueInfo?: { current: number; total: number }
  savedStrokes?: string
  onApply: (maskDataUrl: string) => void
  onSkip?: () => void
  onBack?: () => void
  canGoBack?: boolean
  onSaveStrokes?: (dataUrl: string) => void
  onClose: () => void
}

export function MaskEditor({ imageUrl, photoLabel, queueInfo, savedStrokes, onApply, onSkip, onBack, canGoBack, onSaveStrokes, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [brushSize, setBrushSize] = useState(20)
  const [tool, setTool] = useState<Tool>('brush')
  const [painting, setPainting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  const strokesRef = useRef<ImageData[]>([])
  const imgRef = useRef<HTMLImageElement | null>(null)
  const scaleRef = useRef(1)
  const panningRef = useRef(false)
  const lastPanRef = useRef({ x: 0, y: 0 })
  const canvasReadyRef = useRef(false)

  // Save current canvas state before closing
  const saveCurrentStrokes = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !onSaveStrokes) return
    // Check if canvas has any content
    const ctx = canvas.getContext('2d')!
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const hasContent = data.data.some((v, i) => i % 4 === 3 && v > 0)
    if (hasContent) {
      onSaveStrokes(canvas.toDataURL('image/png'))
    } else {
      onSaveStrokes('')
    }
  }, [onSaveStrokes])

  // Load image and set up canvas
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      fitCanvas()
    }
    img.src = imageUrl
  }, [imageUrl])

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const img = imgRef.current
    if (!canvas || !container || !img) return

    const maxW = container.clientWidth - 32
    const maxH = container.clientHeight - 32
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
    scaleRef.current = scale

    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)

    strokesRef.current = []
    setZoom(1)
    setPan({ x: 0, y: 0 })
    canvasReadyRef.current = true

    // Restore saved strokes if available
    if (savedStrokes) {
      const savedImg = new Image()
      savedImg.onload = () => {
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(savedImg, 0, 0, canvas.width, canvas.height)
      }
      savedImg.src = savedStrokes
    }
  }, [savedStrokes])

  useEffect(() => {
    window.addEventListener('resize', fitCanvas)
    return () => window.removeEventListener('resize', fitCanvas)
  }, [fitCanvas])

  // Close on Escape (save strokes first)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        saveCurrentStrokes()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, saveCurrentStrokes])

  // Zoom with mouse wheel
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.15 : 0.15
      setZoom((z) => Math.min(Math.max(z + delta, 1), 8))
    }
    container.addEventListener('wheel', handler, { passive: false })
    return () => container.removeEventListener('wheel', handler)
  }, [])

  // Clamp pan when zoom changes
  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 })
  }, [zoom])

  const getCanvasPos = (e: PointerEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    }
  }

  const drawDot = (x: number, y: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(255, 60, 60, 0.45)'
    }
    ctx.beginPath()
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  const onPointerDown = (e: PointerEvent) => {
    // Right-click = pan
    if (e.button === 2) {
      e.preventDefault()
      panningRef.current = true
      lastPanRef.current = { x: e.clientX, y: e.clientY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }

    // Left-click = paint/erase
    if (e.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    strokesRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))

    setPainting(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const pos = getCanvasPos(e)
    drawDot(pos.x, pos.y)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (panningRef.current) {
      const dx = e.clientX - lastPanRef.current.x
      const dy = e.clientY - lastPanRef.current.y
      lastPanRef.current = { x: e.clientX, y: e.clientY }
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
      return
    }
    if (!painting) return
    const pos = getCanvasPos(e)
    drawDot(pos.x, pos.y)
  }

  const onPointerUp = () => {
    if (panningRef.current) {
      panningRef.current = false
      return
    }
    setPainting(false)
  }

  const onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  const undo = () => {
    const canvas = canvasRef.current
    if (!canvas || strokesRef.current.length === 0) return
    const ctx = canvas.getContext('2d')!
    const prev = strokesRef.current.pop()!
    ctx.putImageData(prev, 0, 0)
  }

  const clearAll = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // Save for undo
    strokesRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleClose = () => {
    saveCurrentStrokes()
    onClose()
  }

  const apply = async () => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return

    setApplying(true)
    saveCurrentStrokes()

    // Create mask at original image resolution
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = img.naturalWidth
    maskCanvas.height = img.naturalHeight
    const maskCtx = maskCanvas.getContext('2d')!

    // Scale painted strokes up to original resolution (transparent background)
    maskCtx.drawImage(canvas, 0, 0, maskCanvas.width, maskCanvas.height)

    // Read alpha channel to detect painted areas, then write black/white mask
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    const d = maskData.data
    for (let i = 0; i < d.length; i += 4) {
      const painted = d[i + 3] > 10
      d[i] = painted ? 255 : 0
      d[i + 1] = painted ? 255 : 0
      d[i + 2] = painted ? 255 : 0
      d[i + 3] = 255
    }
    maskCtx.putImageData(maskData, 0, 0)

    const maskDataUrl = maskCanvas.toDataURL('image/png')
    onApply(maskDataUrl)
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div class="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Toolbar */}
      <div class="flex-shrink-0 flex flex-wrap items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-sm font-medium text-zinc-300 whitespace-nowrap">
            Retouche manuelle
            {photoLabel && <span class="text-zinc-500 font-normal"> — {photoLabel}</span>}
            {queueInfo && <span class="text-zinc-600 font-normal"> ({queueInfo.current}/{queueInfo.total})</span>}
          </h2>

          {/* Tool toggle */}
          <div class="flex items-center gap-0.5 border border-zinc-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setTool('brush')}
              class={`px-2.5 py-1 text-xs transition-colors ${
                tool === 'brush'
                  ? 'bg-red-500/30 text-red-300'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
              title="Pinceau (peindre)"
            >
              🖌️ Pinceau
            </button>
            <button
              onClick={() => setTool('eraser')}
              class={`px-2.5 py-1 text-xs transition-colors ${
                tool === 'eraser'
                  ? 'bg-blue-500/30 text-blue-300'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
              title="Gomme (effacer)"
            >
              ✏️ Gomme
            </button>
          </div>

          <div class="flex items-center gap-2">
            <label class="text-xs text-zinc-500">Taille</label>
            <input
              type="range"
              min="5"
              max="80"
              value={brushSize}
              onInput={(e) => setBrushSize(Number((e.target as HTMLInputElement).value))}
              class="w-24 accent-amber-400"
            />
            <span class="text-xs text-zinc-400 w-8">{brushSize}px</span>
          </div>
          {/* Zoom controls */}
          <div class="flex items-center gap-1 border-l border-zinc-700 pl-3">
            <button
              onClick={() => setZoom((z) => Math.max(z - 0.25, 1))}
              class="px-1.5 py-0.5 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              -
            </button>
            <button
              onClick={resetZoom}
              class="px-2 py-0.5 text-xs rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors min-w-[3.5rem] text-center"
            >
              {zoomPercent}%
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(z + 0.25, 8))}
              class="px-1.5 py-0.5 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              +
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2 ml-auto">
          {onBack && (
            <button
              onClick={onBack}
              disabled={!canGoBack}
              class={`px-3 py-1.5 text-xs rounded transition-colors ${
                canGoBack
                  ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  : 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
              }`}
            >
              ← Retour
            </button>
          )}
          <button
            onClick={undo}
            class="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={clearAll}
            class="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Effacer tout
          </button>
          {onSkip && (
            <button
              onClick={onSkip}
              class="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Passer
            </button>
          )}
          <button
            onClick={apply}
            disabled={applying}
            class={`px-4 py-1.5 text-xs rounded font-medium transition-colors ${
              applying
                ? 'bg-amber-600 text-amber-200 cursor-wait'
                : 'bg-amber-500 text-zinc-900 hover:bg-amber-400 cursor-pointer'
            }`}
          >
            {applying ? 'Traitement...' : 'Appliquer'}
          </button>
          <button
            onClick={handleClose}
            class="ml-2 text-zinc-400 hover:text-white text-xl leading-none px-2 py-1 rounded hover:bg-zinc-700 transition-colors"
            title="Fermer (Échap)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        class="flex-1 flex items-center justify-center overflow-hidden p-4 relative"
        onContextMenu={onContextMenu}
        onMouseMove={(e: MouseEvent) => {
          const rect = containerRef.current!.getBoundingClientRect()
          setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        }}
        onMouseLeave={() => setCursorPos(null)}
      >
        <div
          class="relative"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'center center',
          }}
        >
          {/* Background image */}
          <img
            src={imageUrl}
            class="block rounded"
            style={{
              width: canvasRef.current?.width ? `${canvasRef.current.width}px` : 'auto',
              height: canvasRef.current?.height ? `${canvasRef.current.height}px` : 'auto',
            }}
            draggable={false}
          />
          {/* Paint canvas overlay */}
          <canvas
            ref={canvasRef}
            class="absolute inset-0 rounded"
            style={{ cursor: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={onContextMenu}
          />
        </div>
        {/* Circle cursor */}
        {cursorPos && (
          <div
            class="absolute pointer-events-none rounded-full border-2"
            style={{
              left: cursorPos.x - (brushSize * zoom) / 2,
              top: cursorPos.y - (brushSize * zoom) / 2,
              width: brushSize * zoom,
              height: brushSize * zoom,
              borderColor: tool === 'eraser' ? 'rgba(96, 165, 250, 0.7)' : 'rgba(255, 60, 60, 0.7)',
            }}
          />
        )}
      </div>

      {/* Hint */}
      <div class="flex-shrink-0 text-center py-2">
        <p class="text-xs text-zinc-600">
          {tool === 'brush' ? 'Peignez les zones à réparer' : 'Gommez les zones à retirer'}
          &nbsp;&middot; Molette = zoom &middot; Clic droit = déplacer
        </p>
      </div>
    </div>
  )
}
