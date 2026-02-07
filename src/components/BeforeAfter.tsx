import { useState, useRef, useEffect } from 'preact/hooks'

interface Props {
  original: string
  result: string
  label?: string
  onClose: () => void
}

export function BeforeAfter({ original, result, label, onClose }: Props) {
  const [position, setPosition] = useState(50)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const panningRef = useRef(false)
  const lastPanRef = useRef({ x: 0, y: 0 })

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Zoom with mouse wheel
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.15 : 0.15
      setZoom((z) => Math.min(Math.max(z + delta, 1), 8))
    }
    wrapper.addEventListener('wheel', handler, { passive: false })
    return () => wrapper.removeEventListener('wheel', handler)
  }, [])

  // Clamp pan when zoom resets
  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 })
  }, [zoom])

  const updatePosition = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    setPosition((x / rect.width) * 100)
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

    if (e.button !== 0) return
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    updatePosition(e.clientX)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (panningRef.current) {
      const dx = e.clientX - lastPanRef.current.x
      const dy = e.clientY - lastPanRef.current.y
      lastPanRef.current = { x: e.clientX, y: e.clientY }
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
      return
    }
    if (dragging.current) updatePosition(e.clientX)
  }

  const onPointerUp = () => {
    dragging.current = false
    panningRef.current = false
  }

  const onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // Close when clicking the backdrop (not the content)
  const onBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div
      class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onBackdropClick}
      onContextMenu={onContextMenu}
    >
      <div ref={wrapperRef} class="max-w-4xl w-full">
        {/* Header */}
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm text-zinc-400">{label || 'Comparaison'}</p>
          <div class="flex items-center gap-2">
            {/* Zoom controls */}
            <div class="flex items-center gap-1">
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
            <button
              onClick={onClose}
              class="text-zinc-400 hover:text-white text-2xl leading-none px-2 py-1 rounded hover:bg-zinc-700 transition-colors"
              title="Fermer (Échap)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Slider container */}
        <div class="overflow-hidden rounded-lg">
          <div
            ref={containerRef}
            class="relative select-none cursor-col-resize"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transformOrigin: 'center center',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={onContextMenu}
          >
            {/* Result (full, behind) */}
            <img src={result} class="block w-full" draggable={false} />

            {/* Original (clipped) */}
            <div
              class="absolute inset-0 overflow-hidden"
              style={{ width: `${position}%` }}
            >
              <img
                src={original}
                class="block w-full"
                style={{ width: `${containerRef.current?.offsetWidth || 0}px`, maxWidth: 'none' }}
                draggable={false}
              />
            </div>

            {/* Divider line */}
            <div
              class="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
              style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
            >
              {/* Handle */}
              <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
                <span class="text-zinc-800 text-xs font-bold">⇔</span>
              </div>
            </div>

            {/* Labels */}
            <div class="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 text-xs text-zinc-300">
              Avant
            </div>
            <div class="absolute top-3 right-3 px-2 py-0.5 rounded bg-black/60 text-xs text-zinc-300">
              Après
            </div>
          </div>
        </div>

        {/* Bottom hint */}
        <p class="text-xs text-zinc-600 text-center mt-2">
          Molette pour zoomer &middot; Clic droit pour déplacer &middot; Échap pour fermer
        </p>
      </div>
    </div>
  )
}
