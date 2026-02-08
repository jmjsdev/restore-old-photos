import { useState, useRef, useEffect, useCallback } from 'preact/hooks'
import * as api from '../api'

interface Props {
  imageUrl: string
  photoId?: string
  photoLabel?: string
  queueInfo?: { current: number; total: number }
  onApply: (cropRect: string) => void
  onSkip?: () => void
  onBack?: () => void
  canGoBack?: boolean
  onClose: () => void
}

type RectHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'draw'

const HANDLE_SIZE = 10
const MIN_CROP = 20
const POINT_RADIUS = 9

const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
  w: 'ew-resize', e: 'ew-resize',
  sw: 'nesw-resize', s: 'ns-resize', se: 'nwse-resize',
}

interface Rect { x: number; y: number; w: number; h: number }
interface Point { x: number; y: number }
type Quad = [Point, Point, Point, Point] // TL, TR, BR, BL

/** Detect photo content bounds by comparing pixel luminance to border background.
 *  Returns bounds as fractions (0-1) of image dimensions. */
function detectContentBounds(imageUrl: string): Promise<{ top: number; left: number; right: number; bottom: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const maxDim = 512
      const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1)
      const w = Math.round(img.naturalWidth * scale)
      const h = Math.round(img.naturalHeight * scale)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)

      const { data } = ctx.getImageData(0, 0, w, h)

      // Grayscale
      const gray = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) {
        gray[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114)
      }

      // Sample border (~2% thick) to determine background luminance
      const bs = Math.max(2, Math.round(Math.min(w, h) * 0.02))
      let bgSum = 0, bgN = 0
      for (let y = 0; y < bs; y++)
        for (let x = 0; x < w; x++) { bgSum += gray[y * w + x]; bgSum += gray[(h - 1 - y) * w + x]; bgN += 2 }
      for (let y = bs; y < h - bs; y++)
        for (let x = 0; x < bs; x++) { bgSum += gray[y * w + x]; bgSum += gray[y * w + (w - 1 - x)]; bgN += 2 }
      const bgLum = bgSum / bgN

      const lumThresh = 25

      // Per-row content ratio
      const rowRatio = new Float32Array(h)
      for (let y = 0; y < h; y++) {
        let n = 0
        for (let x = 0; x < w; x++) if (Math.abs(gray[y * w + x] - bgLum) > lumThresh) n++
        rowRatio[y] = n / w
      }

      // Per-column content ratio
      const colRatio = new Float32Array(w)
      for (let x = 0; x < w; x++) {
        let n = 0
        for (let y = 0; y < h; y++) if (Math.abs(gray[y * w + x] - bgLum) > lumThresh) n++
        colRatio[x] = n / h
      }

      // Find first/last row/col with significant content (>10%)
      const ct = 0.10
      let top = 0, bottom = h - 1, left = 0, right = w - 1
      while (top < h && rowRatio[top] < ct) top++
      while (bottom > top && rowRatio[bottom] < ct) bottom--
      while (left < w && colRatio[left] < ct) left++
      while (right > left && colRatio[right] < ct) right--

      // Small margin
      const mx = Math.round(w * 0.005)
      const my = Math.round(h * 0.005)
      top = Math.max(0, top - my)
      bottom = Math.min(h - 1, bottom + my)
      left = Math.max(0, left - mx)
      right = Math.min(w - 1, right + mx)

      resolve({ top: top / h, left: left / w, right: (right + 1) / w, bottom: (bottom + 1) / h })
    }
    img.src = imageUrl
  })
}

const POINT_LABELS = ['HG', 'HD', 'BD', 'BG']

export function CropEditor({ imageUrl, photoId, photoLabel, queueInfo, onApply, onSkip, onBack, canGoBack, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgWrapperRef = useRef<HTMLDivElement>(null)
  const [imgDisplay, setImgDisplay] = useState({ w: 0, h: 0 })
  const [imgNat, setImgNat] = useState({ w: 0, h: 0 })
  const [mode, setMode] = useState<'rect' | 'persp' | 'ellipse'>('rect')
  const [autoLoading, setAutoLoading] = useState(false)
  const autoCropRef = useRef<(() => void) | null>(null)

  // Rect mode state
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 })
  const [rectDrag, setRectDrag] = useState<{
    handle: RectHandle
    startMouse: Point
    startCrop: Rect
  } | null>(null)

  // Perspective mode state: TL, TR, BR, BL
  const [points, setPoints] = useState<Quad>([
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
  ])
  const [perspDrag, setPerspDrag] = useState<{
    idx: number
    startMouse: Point
    startPoint: Point
  } | null>(null)

  const autoDetectOnLoad = useRef(false)

  // Load image and compute display size
  useEffect(() => {
    autoDetectOnLoad.current = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImgNat({ w: img.naturalWidth, h: img.naturalHeight })
      fit(img.naturalWidth, img.naturalHeight)
      autoDetectOnLoad.current = true
    }
    img.src = imageUrl
  }, [imageUrl])

  // Auto-detect on open
  useEffect(() => {
    if (autoDetectOnLoad.current && imgDisplay.w > 0 && photoId) {
      autoDetectOnLoad.current = false
      autoCropRef.current?.()
    }
  }, [imgDisplay.w])

  const fit = useCallback((natW: number, natH: number) => {
    const container = containerRef.current
    if (!container) return
    const maxW = container.clientWidth - 64
    const maxH = container.clientHeight - 64
    const scale = Math.min(maxW / natW, maxH / natH, 1)
    const dw = Math.round(natW * scale)
    const dh = Math.round(natH * scale)
    setImgDisplay({ w: dw, h: dh })
    setCrop({ x: 0, y: 0, w: dw, h: dh })
    initPoints(dw, dh)
  }, [])

  const initPoints = (dw: number, dh: number) => {
    const m = Math.round(Math.min(dw, dh) * 0.05)
    setPoints([
      { x: m, y: m },
      { x: dw - m, y: m },
      { x: dw - m, y: dh - m },
      { x: m, y: dh - m },
    ])
  }

  useEffect(() => {
    const handler = () => { if (imgNat.w > 0) fit(imgNat.w, imgNat.h) }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [fit, imgNat])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // --- Rect mode drag handling ---
  useEffect(() => {
    if (!rectDrag || (mode !== 'rect' && mode !== 'ellipse')) return
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - rectDrag.startMouse.x
      const dy = e.clientY - rectDrag.startMouse.y
      const s = rectDrag.startCrop
      let x = s.x, y = s.y, w = s.w, h = s.h

      switch (rectDrag.handle) {
        case 'move': x += dx; y += dy; break
        case 'nw': x += dx; y += dy; w -= dx; h -= dy; break
        case 'n': y += dy; h -= dy; break
        case 'ne': w += dx; y += dy; h -= dy; break
        case 'e': w += dx; break
        case 'se': w += dx; h += dy; break
        case 's': h += dy; break
        case 'sw': x += dx; w -= dx; h += dy; break
        case 'w': x += dx; w -= dx; break
        case 'draw': {
          const curX = s.x + dx
          const curY = s.y + dy
          x = Math.min(s.x, curX)
          y = Math.min(s.y, curY)
          w = Math.abs(curX - s.x)
          h = Math.abs(curY - s.y)
          break
        }
      }

      if (rectDrag.handle !== 'draw') {
        if (w < MIN_CROP) { if (rectDrag.handle.includes('w')) x = s.x + s.w - MIN_CROP; w = MIN_CROP }
        if (h < MIN_CROP) { if (rectDrag.handle.includes('n')) y = s.y + s.h - MIN_CROP; h = MIN_CROP }
      }

      x = Math.max(0, x)
      y = Math.max(0, y)
      w = Math.min(w, imgDisplay.w - x)
      h = Math.min(h, imgDisplay.h - y)

      if (rectDrag.handle === 'move') {
        w = s.w; h = s.h
        x = Math.max(0, Math.min(x, imgDisplay.w - w))
        y = Math.max(0, Math.min(y, imgDisplay.h - h))
      }

      setCrop({ x, y, w, h })
    }
    const onUp = () => setRectDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [rectDrag, mode, imgDisplay])

  // --- Persp mode drag handling ---
  useEffect(() => {
    if (!perspDrag || mode !== 'persp') return
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - perspDrag.startMouse.x
      const dy = e.clientY - perspDrag.startMouse.y
      const nx = Math.max(0, Math.min(perspDrag.startPoint.x + dx, imgDisplay.w))
      const ny = Math.max(0, Math.min(perspDrag.startPoint.y + dy, imgDisplay.h))
      setPoints(prev => {
        const next = [...prev] as Quad
        next[perspDrag.idx] = { x: nx, y: ny }
        return next
      })
    }
    const onUp = () => setPerspDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [perspDrag, mode, imgDisplay])

  const startRectDrag = (e: PointerEvent, handle: RectHandle, customCrop?: Rect) => {
    e.preventDefault()
    e.stopPropagation()
    setRectDrag({
      handle,
      startMouse: { x: e.clientX, y: e.clientY },
      startCrop: customCrop || { ...crop },
    })
  }

  const onBgPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (mode !== 'rect' && mode !== 'ellipse')) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    startRectDrag(e, 'draw', { x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 })
  }

  const startPointDrag = (e: PointerEvent, idx: number) => {
    e.preventDefault()
    e.stopPropagation()
    setPerspDrag({
      idx,
      startMouse: { x: e.clientX, y: e.clientY },
      startPoint: { ...points[idx] },
    })
  }

  // --- Apply ---
  const apply = () => {
    const sx = imgNat.w / imgDisplay.w
    const sy = imgNat.h / imgDisplay.h

    if (mode === 'rect') {
      if (crop.w < 1 || crop.h < 1) return
      onApply(`${Math.round(crop.x * sx)},${Math.round(crop.y * sy)},${Math.round(crop.w * sx)},${Math.round(crop.h * sy)}`)
    } else if (mode === 'ellipse') {
      if (crop.w < 1 || crop.h < 1) return
      onApply(`E:${Math.round(crop.x * sx)},${Math.round(crop.y * sy)},${Math.round(crop.w * sx)},${Math.round(crop.h * sy)}`)
    } else {
      const coords = points.map(p => `${Math.round(p.x * sx)},${Math.round(p.y * sy)}`).join(',')
      onApply(`P:${coords}`)
    }
  }

  // --- Reset ---
  const reset = () => {
    if (mode === 'rect' || mode === 'ellipse') {
      setCrop({ x: 0, y: 0, w: imgDisplay.w, h: imgDisplay.h })
    } else {
      initPoints(imgDisplay.w, imgDisplay.h)
    }
  }

  // --- Auto crop ---
  const autoCrop = async () => {
    setAutoLoading(true)
    try {
      let l: number, t: number, r: number, b: number

      if (photoId) {
        // Server-side detection (more accurate, works on original resolution)
        const result = await api.autoCrop(photoId)
        const sx = imgDisplay.w / imgNat.w
        const sy = imgDisplay.h / imgNat.h
        l = result.x * sx
        t = result.y * sy
        r = (result.x + result.w) * sx
        b = (result.y + result.h) * sy
      } else {
        // Client-side fallback
        const bounds = await detectContentBounds(imageUrl)
        l = bounds.left * imgDisplay.w
        t = bounds.top * imgDisplay.h
        r = bounds.right * imgDisplay.w
        b = bounds.bottom * imgDisplay.h
      }

      if (mode === 'rect' || mode === 'ellipse') {
        setCrop({ x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(b - t) })
      } else {
        setPoints([{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }])
      }
    } finally {
      setAutoLoading(false)
    }
  }
  autoCropRef.current = autoCrop

  // --- Mode switch ---
  const switchMode = (newMode: 'rect' | 'persp' | 'ellipse') => {
    if (newMode === mode) return
    if (newMode === 'persp') {
      // Initialize points from current crop rect
      const c = (mode === 'rect' || mode === 'ellipse') ? crop : crop
      setPoints([
        { x: c.x, y: c.y },
        { x: c.x + c.w, y: c.y },
        { x: c.x + c.w, y: c.y + c.h },
        { x: c.x, y: c.y + c.h },
      ])
    } else if (mode === 'persp') {
      // Initialize crop rect from bounding box of points
      const xs = points.map(p => p.x)
      const ys = points.map(p => p.y)
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      setCrop({ x: minX, y: minY, w: maxX - minX, h: maxY - minY })
    }
    // rect ↔ ellipse: shares the same crop state, no conversion needed
    setMode(newMode)
  }

  // --- Rect handle positions ---
  const hs = HANDLE_SIZE
  const rectHandles: { handle: RectHandle; left: number; top: number }[] = [
    { handle: 'nw', left: crop.x - hs / 2, top: crop.y - hs / 2 },
    { handle: 'n', left: crop.x + crop.w / 2 - hs / 2, top: crop.y - hs / 2 },
    { handle: 'ne', left: crop.x + crop.w - hs / 2, top: crop.y - hs / 2 },
    { handle: 'e', left: crop.x + crop.w - hs / 2, top: crop.y + crop.h / 2 - hs / 2 },
    { handle: 'se', left: crop.x + crop.w - hs / 2, top: crop.y + crop.h - hs / 2 },
    { handle: 's', left: crop.x + crop.w / 2 - hs / 2, top: crop.y + crop.h - hs / 2 },
    { handle: 'sw', left: crop.x - hs / 2, top: crop.y + crop.h - hs / 2 },
    { handle: 'w', left: crop.x - hs / 2, top: crop.y + crop.h / 2 - hs / 2 },
  ]

  // --- Dimension display ---
  const sx = imgNat.w / (imgDisplay.w || 1)
  const sy = imgNat.h / (imgDisplay.h || 1)
  let dimText = ''
  if (mode === 'rect' || mode === 'ellipse') {
    dimText = `${Math.round(crop.w * sx)} × ${Math.round(crop.h * sy)} px`
  } else {
    // Approximate output size from perspective quadrilateral
    const dist = (a: Point, b: Point) => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
    const wTop = dist(points[0], points[1]) * sx
    const wBot = dist(points[3], points[2]) * sx
    const hLeft = dist(points[0], points[3]) * sy
    const hRight = dist(points[1], points[2]) * sy
    dimText = `~${Math.round(Math.max(wTop, wBot))} × ${Math.round(Math.max(hLeft, hRight))} px`
  }

  // SVG polygon points string for perspective
  const polyPoints = points.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div class="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Toolbar */}
      <div class="flex-shrink-0 flex flex-wrap items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-medium text-zinc-300 whitespace-nowrap">
            Recadrage
            {photoLabel && <span class="text-zinc-500 font-normal"> — {photoLabel}</span>}
            {queueInfo && <span class="text-zinc-600 font-normal"> ({queueInfo.current}/{queueInfo.total})</span>}
          </h2>

          {/* Mode toggle */}
          <div class="flex items-center gap-0.5 border border-zinc-700 rounded-lg overflow-hidden">
            <button
              onClick={() => switchMode('rect')}
              class={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm transition-colors ${
                mode === 'rect' ? 'bg-amber-500/30 text-amber-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1" /></svg>
              Rectangle
            </button>
            <button
              onClick={() => switchMode('ellipse')}
              class={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm transition-colors ${
                mode === 'ellipse' ? 'bg-amber-500/30 text-amber-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="8" rx="7" ry="5" /></svg>
              Ellipse
            </button>
            <button
              onClick={() => switchMode('persp')}
              class={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm transition-colors ${
                mode === 'persp' ? 'bg-amber-500/30 text-amber-300' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2L12 3L14 13L2 14Z" /><circle cx="4" cy="2" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none" /><circle cx="14" cy="13" r="1.2" fill="currentColor" stroke="none" /><circle cx="2" cy="14" r="1.2" fill="currentColor" stroke="none" /></svg>
              Perspective
            </button>
          </div>

          <span class="text-xs text-zinc-500">{dimText}</span>
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
            onClick={autoCrop}
            disabled={autoLoading}
            class={`px-3 py-1.5 text-xs rounded transition-colors ${
              autoLoading
                ? 'bg-zinc-800 text-zinc-500 cursor-wait'
                : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
            }`}
          >
            {autoLoading ? 'Détection...' : 'Auto'}
          </button>
          <button
            onClick={reset}
            class="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Réinitialiser
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
            class="px-4 py-1.5 text-xs rounded font-medium bg-amber-500 text-zinc-900 hover:bg-amber-400 cursor-pointer transition-colors"
          >
            Appliquer
          </button>
          <button
            onClick={onClose}
            class="ml-2 text-zinc-400 hover:text-white text-xl leading-none px-2 py-1 rounded hover:bg-zinc-700 transition-colors"
            title="Fermer (Échap)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Image + crop overlay */}
      <div ref={containerRef} class="flex-1 flex items-center justify-center overflow-hidden p-8">
        {imgDisplay.w > 0 && (
          <div
            ref={imgWrapperRef}
            class="relative select-none"
            style={{ width: imgDisplay.w, height: imgDisplay.h, cursor: (mode === 'rect' || mode === 'ellipse') ? 'crosshair' : 'default' }}
            onPointerDown={onBgPointerDown}
          >
            <img
              src={imageUrl}
              class="block pointer-events-none"
              style={{ width: imgDisplay.w, height: imgDisplay.h }}
              draggable={false}
            />

            {mode === 'rect' ? (
              <>
                {/* Dark overlays */}
                <div class="absolute pointer-events-none bg-black/60" style={{ left: 0, top: 0, width: imgDisplay.w, height: crop.y }} />
                <div class="absolute pointer-events-none bg-black/60" style={{ left: 0, top: crop.y + crop.h, width: imgDisplay.w, height: imgDisplay.h - crop.y - crop.h }} />
                <div class="absolute pointer-events-none bg-black/60" style={{ left: 0, top: crop.y, width: crop.x, height: crop.h }} />
                <div class="absolute pointer-events-none bg-black/60" style={{ left: crop.x + crop.w, top: crop.y, width: imgDisplay.w - crop.x - crop.w, height: crop.h }} />

                {/* Crop border + move handle */}
                <div
                  class="absolute border border-white/80"
                  style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h, cursor: 'move' }}
                  onPointerDown={(e: PointerEvent) => startRectDrag(e, 'move')}
                />

                {/* Resize handles */}
                {rectHandles.map(({ handle, left, top }) => (
                  <div
                    key={handle}
                    class="absolute bg-white border border-zinc-500 rounded-sm"
                    style={{ left, top, width: hs, height: hs, cursor: HANDLE_CURSORS[handle] }}
                    onPointerDown={(e: PointerEvent) => startRectDrag(e, handle)}
                  />
                ))}
              </>
            ) : mode === 'ellipse' ? (
              <>
                {/* SVG overlay with ellipse hole */}
                <svg class="absolute inset-0 pointer-events-none" width={imgDisplay.w} height={imgDisplay.h}>
                  <defs>
                    <mask id="ellipse-mask">
                      <rect width="100%" height="100%" fill="white" />
                      <ellipse
                        cx={crop.x + crop.w / 2}
                        cy={crop.y + crop.h / 2}
                        rx={crop.w / 2}
                        ry={crop.h / 2}
                        fill="black"
                      />
                    </mask>
                  </defs>
                  <rect
                    width="100%"
                    height="100%"
                    fill="rgba(0,0,0,0.6)"
                    mask="url(#ellipse-mask)"
                  />
                  <ellipse
                    cx={crop.x + crop.w / 2}
                    cy={crop.y + crop.h / 2}
                    rx={crop.w / 2}
                    ry={crop.h / 2}
                    fill="none"
                    stroke="white"
                    stroke-width="1.5"
                    stroke-dasharray="8 4"
                  />
                </svg>

                {/* Crop border (invisible but draggable for move) */}
                <div
                  class="absolute"
                  style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h, cursor: 'move' }}
                  onPointerDown={(e: PointerEvent) => startRectDrag(e, 'move')}
                />

                {/* Resize handles */}
                {rectHandles.map(({ handle, left, top }) => (
                  <div
                    key={handle}
                    class="absolute bg-white border border-zinc-500 rounded-sm"
                    style={{ left, top, width: hs, height: hs, cursor: HANDLE_CURSORS[handle] }}
                    onPointerDown={(e: PointerEvent) => startRectDrag(e, handle)}
                  />
                ))}
              </>
            ) : (
              /* Perspective mode: SVG overlay with quadrilateral + draggable points */
              <svg
                class="absolute inset-0"
                width={imgDisplay.w}
                height={imgDisplay.h}
                style={{ cursor: 'default' }}
              >
                {/* Dark overlay with transparent polygon hole */}
                <defs>
                  <mask id="persp-mask">
                    <rect width="100%" height="100%" fill="white" />
                    <polygon points={polyPoints} fill="black" />
                  </mask>
                </defs>
                <rect
                  width="100%"
                  height="100%"
                  fill="rgba(0,0,0,0.6)"
                  mask="url(#persp-mask)"
                  style={{ pointerEvents: 'none' }}
                />

                {/* Quadrilateral border (dashed) */}
                <polygon
                  points={polyPoints}
                  fill="none"
                  stroke="white"
                  stroke-width="1.5"
                  stroke-dasharray="8 4"
                  style={{ pointerEvents: 'none' }}
                />

                {/* Edge midpoint lines (guides) */}
                {points.map((p, i) => {
                  const next = points[(i + 1) % 4]
                  const mx = (p.x + next.x) / 2
                  const my = (p.y + next.y) / 2
                  return (
                    <circle
                      key={`mid-${i}`}
                      cx={mx}
                      cy={my}
                      r="3"
                      fill="white"
                      opacity="0.4"
                      style={{ pointerEvents: 'none' }}
                    />
                  )
                })}

                {/* Corner points */}
                {points.map((p, i) => (
                  <g key={i}>
                    {/* Larger invisible hit area */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={POINT_RADIUS + 8}
                      fill="transparent"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e: PointerEvent) => startPointDrag(e, i)}
                    />
                    {/* Visible point */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={POINT_RADIUS}
                      fill="white"
                      stroke="#555"
                      stroke-width="1.5"
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Label */}
                    <text
                      x={p.x}
                      y={p.y + 1}
                      text-anchor="middle"
                      dominant-baseline="central"
                      fill="#333"
                      font-size="9"
                      font-weight="bold"
                      style={{ pointerEvents: 'none' }}
                    >
                      {POINT_LABELS[i]}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Hint */}
      <div class="flex-shrink-0 text-center py-2">
        <p class="text-xs text-zinc-600">
          {mode === 'rect'
            ? 'Glissez les poignées pour ajuster \u00b7 Glissez l\'intérieur pour déplacer \u00b7 Cliquez à l\'extérieur pour un nouveau cadrage'
            : mode === 'ellipse'
            ? 'Glissez les poignées pour ajuster l\'ellipse \u00b7 L\'extérieur sera transparent'
            : 'Glissez les 4 coins pour définir la zone \u00b7 L\'image sera redressée automatiquement'}
        </p>
      </div>
    </div>
  )
}
