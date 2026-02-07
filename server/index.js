import dotenv from 'dotenv'
dotenv.config({ path: ['.env.local', '.env'] })
import express from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads')
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(ROOT, 'results')
const AI_DIR = path.join(ROOT, 'ai')
const VENV_PYTHON = path.join(AI_DIR, 'venv', 'bin', 'python')
const SETUP_PID_FILE = '/data/setup.pid'
const SETUP_LOG_FILE = '/data/setup.log'
const SETUP_ERROR_FILE = '/data/setup.error'

// Python et aiReady sont dynamiques — le venv peut être créé pendant que le serveur tourne
function getPython() {
  return existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3'
}

function isAiReady() {
  return existsSync(VENV_PYTHON)
}

function isSetupRunning() {
  if (!existsSync(SETUP_PID_FILE)) return false
  try {
    const pid = parseInt(readFileSync(SETUP_PID_FILE, 'utf8').trim())
    process.kill(pid, 0) // test if process exists
    return true
  } catch {
    return false
  }
}

function getSetupError() {
  try {
    return readFileSync(SETUP_ERROR_FILE, 'utf8').trim()
  } catch {
    return null
  }
}

function getSetupLog() {
  try {
    const log = readFileSync(SETUP_LOG_FILE, 'utf8')
    const lines = log.trim().split('\n').filter(l => l.startsWith('[setup'))
    const last = lines[lines.length - 1] || ''
    // Parse "[setup 2/5] Message..." → { step: 2, total: 5, message: "Message..." }
    const match = last.match(/^\[setup (\d+)\/(\d+)\]\s*(.*)$/)
    if (match) return { step: parseInt(match[1]), total: parseInt(match[2]), message: match[3] }
    if (last.includes('[setup done]')) return { step: -1, total: -1, message: last.replace('[setup done] ', '') }
    return { step: 0, total: 0, message: last }
  } catch {
    return { step: 0, total: 0, message: '' }
  }
}

if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const app = express()
app.use(express.json())
const DIST_DIR = path.join(ROOT, 'dist')

app.use(express.static(DIST_DIR))
app.use('/uploads', express.static(UPLOADS_DIR))
app.use('/results', express.static(RESULTS_DIR))

// --- Storage ---

const photos = new Map()
const jobs = new Map()

// Track running processes per job so they can be killed on cancel
const runningProcs = new Map()

// --- Heartbeat : stopper les process si le frontend disparaît ---

let lastHeartbeat = Date.now()
const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_SECONDS || '10') * 1000

function checkHeartbeat() {
  if (Date.now() - lastHeartbeat < HEARTBEAT_TIMEOUT_MS) return

  const active = [...jobs.values()].filter(j => j.status === 'processing' || j.status === 'pending')
  if (active.length === 0) return

  console.log(`Heartbeat timeout — annulation de ${active.length} job(s) actif(s)`)
  for (const job of active) {
    job.status = 'cancelled'
    job.currentStep = null
    job.waitingStep = null
    job.waitingImage = null
    const proc = runningProcs.get(job.id)
    if (proc) {
      proc.kill('SIGTERM')
      runningProcs.delete(job.id)
    }
  }
}

const heartbeatTimer = setInterval(checkHeartbeat, 5000)

const MANUAL_STEPS = new Set(['crop', 'inpaint'])

// --- Job queue concurrency ---

const maxConcurrentLimit = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS) || 2)
let maxConcurrent = maxConcurrentLimit

function enqueueJob(job) {
  processNext()
}

function jobHasManualSteps(job) {
  return job.steps.some(s => MANUAL_STEPS.has(s))
}

/** Vérifie si le prochain step d'un job va immédiatement se mettre en waiting_input */
function jobWillPauseImmediately(job) {
  const idx = job.resumeFromStep || 0
  const step = job.steps[idx]
  if (step === 'crop' && !job.cropRect) return true
  if (step === 'inpaint' && !job.maskPath) return true
  return false
}

function processNext() {
  const allJobs = [...jobs.values()]
  const running = allJobs.filter((j) => j.status === 'processing').length

  // Si un job attend une action manuelle, ne pas lancer d'autre job avec étapes manuelles
  const hasWaitingManual = allJobs.some(j => j.status === 'waiting_input')

  const pending = allJobs
    .filter((j) => j.status === 'pending')
    .filter((j) => !hasWaitingManual || !jobHasManualSteps(j))
    .sort((a, b) => (a.priority || 0) - (b.priority || 0))

  let slotsUsed = 0
  for (const job of pending) {
    const willPause = jobWillPauseImmediately(job)
    // Les jobs qui vont immédiatement se mettre en pause ne consomment pas de slot
    if (!willPause && running + slotsUsed >= maxConcurrent) continue
    if (!willPause) slotsUsed++
    processJob(job).then(() => processNext())
  }
}

// --- Upload ---

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp']
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, allowed.includes(ext))
  },
  limits: { fileSize: 50 * 1024 * 1024 },
})

app.post('/api/photos', (req, res) => {
  upload.array('photos', 20)(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err.message)
      return res.status(400).json({ error: err.message })
    }
    const uploaded = []
    for (const file of req.files) {
      const photo = {
        id: randomUUID(),
        filename: file.filename,
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
      }
      photos.set(photo.id, photo)
      uploaded.push(photo)
    }
    res.json(uploaded)
  })
})

app.get('/api/photos', (_req, res) => {
  res.json([...photos.values()])
})

app.delete('/api/photos/:id', (req, res) => {
  photos.delete(req.params.id)
  res.json({ ok: true })
})

app.delete('/api/photos', (_req, res) => {
  photos.clear()
  res.json({ ok: true })
})

// --- Import result as new photo ---

app.post('/api/photos/import', (req, res) => {
  const { resultPath } = req.body
  if (!resultPath) return res.status(400).json({ error: 'resultPath is required' })

  // Le frontend envoie l'URL publique : /results/file.png ou /uploads/file.png
  // On mappe vers le vrai dossier (RESULTS_DIR / UPLOADS_DIR)
  let srcFile = null
  const clean = resultPath.replace(/^\//, '')
  if (clean.startsWith('results/')) {
    srcFile = path.join(RESULTS_DIR, clean.slice('results/'.length))
  } else if (clean.startsWith('uploads/')) {
    srcFile = path.join(UPLOADS_DIR, clean.slice('uploads/'.length))
  }

  // Vérification de sécurité : le chemin résolu doit rester dans les dossiers autorisés
  if (!srcFile || (!path.resolve(srcFile).startsWith(path.resolve(RESULTS_DIR)) &&
                   !path.resolve(srcFile).startsWith(path.resolve(UPLOADS_DIR)))) {
    return res.status(403).json({ error: 'Access denied' })
  }
  if (!existsSync(srcFile)) return res.status(404).json({ error: 'File not found' })

  const ext = path.extname(srcFile)
  const newFilename = `${randomUUID()}${ext}`
  const destFile = path.join(UPLOADS_DIR, newFilename)
  copyFileSync(srcFile, destFile)

  const originalName = path.basename(srcFile)
  const photo = {
    id: randomUUID(),
    filename: newFilename,
    originalName,
    uploadedAt: new Date().toISOString(),
  }
  photos.set(photo.id, photo)
  res.json(photo)
})

// --- Jobs ---

const STEP_MODELS = {
  crop: {
    name: 'Recadrage',
    model: 'Manuel',
    repo: '',
    script: 'crop.py',
  },
  inpaint: {
    name: 'Retouche manuelle',
    model: 'LaMa (WACV 2022)',
    repo: 'https://github.com/advimman/lama',
    script: 'inpaint.py',
    needsMask: true,
  },
  spot_removal: {
    name: 'Nettoyage des taches',
    model: 'Multi-échelle + LaMa',
    repo: 'https://github.com/advimman/lama',
    script: 'clean_spots.py',
    models: {
      lama: { name: 'LaMa (IA)', desc: 'Détection multi-échelle + inpainting IA' },
      opencv: { name: 'OpenCV', desc: 'Détection multi-échelle + Navier-Stokes (rapide)' },
    },
    defaultModel: 'lama',
  },
  scratch_removal: {
    name: 'Suppression des rayures',
    model: 'BOPBTL + LaMa',
    repo: 'https://github.com/advimman/lama',
    script: 'restore.py',
    models: {
      lama: { name: 'LaMa (IA)', desc: 'Meilleure qualité, plus lent (~200MB)' },
      opencv: { name: 'OpenCV', desc: 'Rapide, Navier-Stokes' },
    },
    defaultModel: 'lama',
  },
  face_restore: {
    name: 'Restauration des visages',
    model: 'GFPGAN v1.4',
    repo: 'https://github.com/TencentARC/GFPGAN',
    script: 'face_restore.py',
  },
  colorize: {
    name: 'Colorisation',
    model: 'DDColor (ICCV 2023)',
    repo: 'https://github.com/piddnad/DDColor',
    script: 'colorize_ddcolor.py',
    models: {
      ddcolor: { name: 'DDColor', desc: 'ICCV 2023 - meilleure qualité (~912MB)' },
      deoldify_artistic: { name: 'DeOldify Artistic', desc: 'Couleurs vibrantes, idéal pour portraits (~255MB)' },
      deoldify_stable: { name: 'DeOldify Stable', desc: 'Couleurs conservatrices, plus cohérent (~834MB)' },
      siggraph17: { name: 'Siggraph17', desc: 'Zhang et al. 2017 - rapide (~130MB)' },
      eccv16: { name: 'ECCV16', desc: 'Zhang et al. 2016 - classique (~130MB)' },
    },
    defaultModel: 'ddcolor',
  },
  upscale: {
    name: 'Upscale x2',
    model: 'Real-ESRGAN x4plus',
    repo: 'https://github.com/xinntao/Real-ESRGAN',
    script: 'upscale.py',
    models: {
      compact: { name: 'Real-ESRGAN Compact', desc: 'Rapide, bonne qualité (~1MB)' },
      x4plus: { name: 'Real-ESRGAN x4plus', desc: 'Polyvalent, meilleure qualité (~64MB)' },
      'x4plus-anime': { name: 'Real-ESRGAN Anime', desc: 'Optimisé illustrations (~17MB)' },
      x2plus: { name: 'Real-ESRGAN x2plus', desc: 'Upscale natif x2 (~64MB)' },
      lanczos: { name: 'Lanczos (sans IA)', desc: 'Instantané, interpolation classique' },
    },
    defaultModel: 'compact',
  },
  online_restore: {
    name: 'IA en ligne (OpenAI)',
    model: 'GPT-4o Image',
    repo: 'https://platform.openai.com/docs/guides/images',
    script: 'restore_openai.py',
    models: {
      full: { name: 'Restauration complète', desc: 'Répare + colorise + améliore (tout-en-un)' },
      restore: { name: 'Restauration seule', desc: 'Supprime rayures et taches uniquement' },
      colorize: { name: 'Colorisation', desc: 'Colorise en couleurs réalistes' },
      enhance: { name: 'Amélioration', desc: 'Netteté, contraste, détails' },
    },
    defaultModel: 'full',
    requiresApiKey: 'OPENAI_API_KEY',
    disabled: true,
  },
}

app.get('/api/steps', (_req, res) => {
  // Filter out steps that require an API key not configured
  const filtered = {}
  for (const [key, step] of Object.entries(STEP_MODELS)) {
    if (step.disabled) continue
    if (step.requiresApiKey && !process.env[step.requiresApiKey]) continue
    filtered[key] = step
  }
  res.json(filtered)
})

// --- Apply crop immediately (returns new cropped photo) ---

app.post('/api/photos/:id/crop', express.json(), async (req, res) => {
  const photo = photos.get(req.params.id)
  if (!photo) return res.status(404).json({ error: 'Photo not found' })

  const { cropRect } = req.body
  if (!cropRect) return res.status(400).json({ error: 'cropRect is required' })

  const inputPath = path.join(UPLOADS_DIR, photo.filename)
  const newFilename = `${randomUUID()}.png`
  const outputPath = path.join(UPLOADS_DIR, newFilename)

  try {
    await runPythonStep('crop.py', [inputPath, outputPath, cropRect])

    const baseName = sanitizeFilename(photo.originalName.replace(/\.[^.]+$/, ''))
    const croppedPhoto = {
      id: randomUUID(),
      filename: newFilename,
      originalName: `${baseName}_crop.png`,
      uploadedAt: new Date().toISOString(),
    }
    photos.set(croppedPhoto.id, croppedPhoto)
    res.json(croppedPhoto)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/auto-crop/:photoId', async (req, res) => {
  const photo = photos.get(req.params.photoId)
  if (!photo) return res.status(404).json({ error: 'Photo not found' })

  const inputPath = path.join(UPLOADS_DIR, photo.filename)
  try {
    const { execFileSync } = await import('child_process')
    const stdout = execFileSync(getPython(), [
      path.join(AI_DIR, 'auto_crop.py'), inputPath
    ], { timeout: 30000 }).toString().trim()
    const bounds = JSON.parse(stdout)
    res.json(bounds)
  } catch (err) {
    console.error('Auto-crop failed:', err.message)
    res.status(500).json({ error: 'Auto-crop detection failed' })
  }
})

app.get('/api/status', async (_req, res) => {
  const aiReady = isAiReady()
  const setupRunning = isSetupRunning()
  let device = 'cpu'
  if (aiReady) {
    try {
      const { execFileSync } = await import('child_process')
      device = execFileSync(getPython(), ['-c',
        'import torch; print("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")'
      ], { timeout: 10000 }).toString().trim()
    } catch {}
  }
  res.json({
    aiReady,
    device,
    setupRunning,
    setupStatus: setupRunning ? getSetupLog() : null,
    setupError: getSetupError()
  })
})

app.post('/api/jobs', express.json({ limit: '50mb' }), (req, res) => {
  const { photoIds, steps, options, masks, cropRects } = req.body

  if (!isAiReady()) {
    const msg = isSetupRunning()
      ? 'Installation IA en cours, veuillez patienter...'
      : 'IA non configurée. Lancez : cd ai && bash setup.sh'
    return res.status(503).json({ error: msg })
  }

  if (!photoIds?.length || !steps?.length) {
    return res.status(400).json({ error: 'photoIds and steps are required' })
  }

  const validSteps = steps.filter((s) => STEP_MODELS[s])
  if (!validSteps.length) {
    return res.status(400).json({ error: 'No valid steps provided' })
  }

  const created = []
  for (const photoId of photoIds) {
    const photo = photos.get(photoId)
    if (!photo) continue

    // If inpaint step is selected and a mask was provided, save it
    let maskPath = null
    if (validSteps.includes('inpaint') && masks?.[photoId]) {
      const maskId = randomUUID().slice(0, 8)
      const maskFilename = `mask_${maskId}.png`
      maskPath = path.join(UPLOADS_DIR, maskFilename)
      const base64Data = masks[photoId].replace(/^data:image\/\w+;base64,/, '')
      writeFileSync(maskPath, Buffer.from(base64Data, 'base64'))
    }

    // If crop step is selected and a crop rect was provided, store it
    const cropRect = validSteps.includes('crop') && cropRects?.[photoId]
      ? cropRects[photoId]
      : null

    const job = {
      id: randomUUID(),
      photoId,
      photoName: photo.originalName,
      original: `/uploads/${photo.filename}`,
      steps: validSteps,
      options: options || {},
      maskPath,
      cropRect,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      result: null,
      stepResults: [],
      priority: Date.now(),
    }
    jobs.set(job.id, job)
    created.push(job)

    enqueueJob(job)
  }

  res.json(created)
})

app.get('/api/jobs', (_req, res) => {
  lastHeartbeat = Date.now()
  const all = [...jobs.values()]
  const statusOrder = { waiting_input: -1, processing: 0, pending: 1, completed: 2, failed: 2, cancelled: 2 }
  all.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 3
    const sb = statusOrder[b.status] ?? 3
    if (sa !== sb) return sa - sb
    // Within pending: sort by priority ascending (lower = higher priority)
    if (a.status === 'pending' && b.status === 'pending') {
      return (a.priority || 0) - (b.priority || 0)
    }
    // Otherwise by creation date descending
    return new Date(b.createdAt) - new Date(a.createdAt)
  })
  res.json(all.map((job) => {
    const { maskPath, cropRect, currentInputPath, ...rest } = job
    // Add canGoBack for waiting_input jobs
    if (rest.status === 'waiting_input' && rest.resumeFromStep != null) {
      rest.canGoBack = false
      for (let i = rest.resumeFromStep - 1; i >= 0; i--) {
        if (MANUAL_STEPS.has(job.steps[i])) { rest.canGoBack = true; break }
      }
    }
    return rest
  }))
})

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  res.json(job)
})

// --- Settings ---

app.get('/api/settings', (_req, res) => {
  res.json({ maxConcurrent, maxConcurrentLimit })
})

app.put('/api/settings', express.json(), (req, res) => {
  const val = req.body.maxConcurrent
  if (typeof val === 'number' && val >= 1 && val <= maxConcurrentLimit) {
    maxConcurrent = Math.round(val)
  }
  // Trigger queue in case new slots opened
  processNext()
  res.json({ maxConcurrent, maxConcurrentLimit })
})

// --- Reorder pending jobs ---

app.put('/api/jobs/reorder', express.json(), (req, res) => {
  const { jobIds } = req.body
  if (!Array.isArray(jobIds)) return res.status(400).json({ error: 'jobIds array required' })

  // Reassign priorities to pending jobs based on their position in the array
  jobIds.forEach((id, index) => {
    const job = jobs.get(id)
    if (job && job.status === 'pending') {
      job.priority = index
    }
  })
  res.json({ ok: true })
})

// --- AI Processing via Python subprocess ---

function runPythonStep(script, args, jobId) {
  const scriptPath = path.join(AI_DIR, script)
  return new Promise((resolve, reject) => {
    const proc = execFile(getPython(), [scriptPath, ...args], {
      timeout: 5 * 60 * 1000, // 5 min max per step
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      runningProcs.delete(jobId)
      if (err) {
        console.error(`  [FAIL] ${script}:`, stderr || err.message)
        reject(new Error(stderr || err.message))
      } else {
        console.log(`  [OK] ${script}:`, stdout.trim())
        resolve(stdout.trim())
      }
    })
    if (jobId) runningProcs.set(jobId, proc)
  })
}

const STEP_PREFIXES = {
  crop: 'CROP',
  inpaint: 'INPAINT',
  spot_removal: 'SPOTS',
  scratch_removal: 'REST',
  face_restore: 'FACE',
  colorize: 'COL',
  upscale: 'UPS',
  online_restore: 'CLOUD',
}

/** Sanitize filename: remove accents, replace special chars */
function sanitizeFilename(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
    .replace(/[^a-zA-Z0-9._-]/g, '_')                  // Replace special chars
    .replace(/_+/g, '_')                                // Collapse multiple underscores
    .replace(/^_|_$/g, '')                              // Trim underscores
}

function getUrlForPath(filePath) {
  if (filePath.startsWith(RESULTS_DIR)) return `/results/${path.basename(filePath)}`
  return `/uploads/${path.basename(filePath)}`
}

async function processJob(job) {
  job.status = 'processing'
  const photo = photos.get(job.photoId)
  if (!photo) {
    job.status = 'failed'
    return
  }

  const origName = sanitizeFilename(path.parse(photo.originalName).name)
  const jobShort = job.id.slice(0, 6)

  const startIndex = job.resumeFromStep || 0
  let currentInput = job.currentInputPath || path.join(UPLOADS_DIR, photo.filename)

  try {
    for (let i = startIndex; i < job.steps.length; i++) {
      const step = job.steps[i]
      const stepInfo = STEP_MODELS[step]
      if (!stepInfo) continue

      // Pause at manual steps needing input
      if (step === 'crop' && !job.cropRect) {
        job.status = 'waiting_input'
        job.waitingStep = step
        job.resumeFromStep = i
        job.currentInputPath = currentInput
        job.waitingImage = getUrlForPath(currentInput)
        job.progress = Math.round((i / job.steps.length) * 100)
        return
      }
      if (step === 'inpaint' && !job.maskPath) {
        job.status = 'waiting_input'
        job.waitingStep = step
        job.resumeFromStep = i
        job.currentInputPath = currentInput
        job.waitingImage = getUrlForPath(currentInput)
        job.progress = Math.round((i / job.steps.length) * 100)
        return
      }

      job.currentStep = step
      job.progress = Math.round((i / job.steps.length) * 100)
      console.log(`Job ${job.id} | Step ${i + 1}/${job.steps.length}: ${stepInfo.name}`)

      // All outputs are PNG, named consistently
      const prefix = STEP_PREFIXES[step] || step
      const outputFilename = `${origName}_${prefix}_${jobShort}.png`
      const outputPath = path.join(RESULTS_DIR, outputFilename)

      // Determine which script and extra args to use based on model choice
      let script = stepInfo.script
      const args = [currentInput]

      // Inpaint step: needs mask as second arg, then output
      if (step === 'inpaint') {
        args.push(job.maskPath, outputPath)
      } else {
        args.push(outputPath)
      }

      if (stepInfo.models) {
        const selectedModel = job.options?.[step] || stepInfo.defaultModel
        if (step === 'colorize') {
          if (selectedModel === 'ddcolor') {
            script = 'colorize_ddcolor.py'
          } else if (selectedModel === 'deoldify_artistic') {
            script = 'colorize_deoldify.py'
            args.push('artistic')
          } else if (selectedModel === 'deoldify_stable') {
            script = 'colorize_deoldify.py'
            args.push('stable')
          } else {
            script = 'colorize.py'
            args.push(selectedModel)
          }
        }
        if (step === 'scratch_removal' || step === 'spot_removal') {
          args.push(selectedModel)
        }
        if (step === 'upscale') {
          args.push(selectedModel, '2')
        }
        if (step === 'online_restore') {
          // Map model keys to comma-separated steps expected by restore_openai.py
          const onlineStepsMap = {
            full: 'restore,colorize,enhance',
            restore: 'restore',
            colorize: 'colorize',
            enhance: 'enhance',
          }
          args.push(onlineStepsMap[selectedModel] || selectedModel)
        }
      }

      if (step === 'crop') args.push(job.cropRect)

      // Check cancellation before starting step
      if (job.status === 'cancelled') return

      await runPythonStep(script, args, job.id)

      // Check cancellation after step completes
      if (job.status === 'cancelled') return

      // Clean up after manual steps
      if (step === 'inpaint' && job.maskPath) {
        try { unlinkSync(job.maskPath) } catch {}
        job.maskPath = null
      }
      if (step === 'crop') {
        job.cropRect = null
      }

      // Record step result
      job.stepResults.push({ step, result: `/results/${outputFilename}` })

      currentInput = outputPath
      job.currentInputPath = currentInput

      // Après chaque étape, relancer la queue — permet au prochain job manuel
      // de démarrer pendant que ce job continue ses étapes automatiques
      processNext()
    }

    // Job completed: final result is the last step's output
    job.status = 'completed'
    job.progress = 100
    job.currentStep = null
    job.waitingStep = null
    job.waitingImage = null
    job.result = job.stepResults.length > 0
      ? job.stepResults[job.stepResults.length - 1].result
      : null
  } catch (err) {
    if (job.status === 'cancelled') {
      console.log(`Job ${job.id} cancelled`)
      job.currentStep = null
      return
    }
    console.error(`Job ${job.id} failed at step "${job.currentStep}":`, err.message)
    job.status = 'failed'
    job.error = err.message
    job.failedStep = job.currentStep
    job.failedStepIndex = job.steps.indexOf(job.currentStep)
    job.currentStep = null
  }
}

// --- Submit input for a waiting job ---

app.post('/api/jobs/:id/input', express.json({ limit: '50mb' }), (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'waiting_input') {
    return res.status(400).json({ error: 'Job is not waiting for input' })
  }

  const { mask, cropRect } = req.body

  if (job.waitingStep === 'inpaint' && mask) {
    const maskId = randomUUID().slice(0, 8)
    const maskFilename = `mask_${maskId}.png`
    job.maskPath = path.join(UPLOADS_DIR, maskFilename)
    const base64Data = mask.replace(/^data:image\/\w+;base64,/, '')
    writeFileSync(job.maskPath, Buffer.from(base64Data, 'base64'))
  }

  if (job.waitingStep === 'crop' && cropRect) {
    job.cropRect = cropRect
  }

  job.waitingStep = null
  job.waitingImage = null
  processJob(job).then(() => processNext())
  res.json({ ok: true })
})

// --- Skip current manual step ---

app.post('/api/jobs/:id/skip', express.json(), (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'waiting_input') {
    return res.status(400).json({ error: 'Job is not waiting for input' })
  }

  job.resumeFromStep = (job.resumeFromStep || 0) + 1
  job.waitingStep = null
  job.waitingImage = null
  processJob(job).then(() => processNext())
  res.json({ ok: true })
})

// --- Go back to previous manual step ---

app.post('/api/jobs/:id/back', express.json(), (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'waiting_input') {
    return res.status(400).json({ error: 'Job is not waiting for input' })
  }

  const currentIdx = job.resumeFromStep || 0

  // Find previous manual step
  let targetIdx = -1
  for (let i = currentIdx - 1; i >= 0; i--) {
    if (MANUAL_STEPS.has(job.steps[i])) {
      targetIdx = i
      break
    }
  }

  if (targetIdx < 0) {
    return res.status(400).json({ error: 'No previous manual step' })
  }

  // Clear inputs for steps from targetIdx onwards
  for (let i = targetIdx; i < job.steps.length; i++) {
    const s = job.steps[i]
    if (s === 'crop') job.cropRect = null
    if (s === 'inpaint') {
      if (job.maskPath) { try { unlinkSync(job.maskPath) } catch {} }
      job.maskPath = null
    }
  }

  // Trim step results to before targetIdx
  job.stepResults = job.stepResults.slice(0, targetIdx)

  // Determine input for targetIdx
  if (job.stepResults.length > 0) {
    const lastResult = job.stepResults[job.stepResults.length - 1]
    job.currentInputPath = path.join(ROOT, lastResult.result.replace(/^\//, ''))
  } else {
    const photo = photos.get(job.photoId)
    job.currentInputPath = photo ? path.join(UPLOADS_DIR, photo.filename) : null
  }

  job.resumeFromStep = targetIdx
  job.waitingStep = null
  job.waitingImage = null
  processJob(job).then(() => processNext())
  res.json({ ok: true })
})

// --- Retry failed step ---

app.post('/api/jobs/:id/retry', express.json(), (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'failed') {
    return res.status(400).json({ error: 'Job is not in failed state' })
  }

  const { model } = req.body || {}
  if (model && job.failedStep) {
    job.options = job.options || {}
    job.options[job.failedStep] = model
  }

  job.resumeFromStep = job.failedStepIndex ?? 0
  job.status = 'processing'
  job.error = null
  job.failedStep = null
  job.failedStepIndex = null
  processJob(job).then(() => processNext())
  res.json({ ok: true })
})

// --- Skip failed step ---

app.post('/api/jobs/:id/skip-failed', express.json(), (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'failed') {
    return res.status(400).json({ error: 'Job is not in failed state' })
  }

  const nextIndex = (job.failedStepIndex ?? 0) + 1
  job.error = null
  job.failedStep = null
  job.failedStepIndex = null

  if (nextIndex >= job.steps.length) {
    // Dernière étape — marquer comme terminé
    job.status = 'completed'
    job.progress = 100
    job.result = job.stepResults.length > 0
      ? job.stepResults[job.stepResults.length - 1].result
      : null
  } else {
    job.resumeFromStep = nextIndex
    job.status = 'processing'
    processJob(job).then(() => processNext())
  }
  res.json({ ok: true })
})

// --- Cancel a job ---

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const cancellable = ['pending', 'processing', 'waiting_input']
  if (!cancellable.includes(job.status)) {
    return res.status(400).json({ error: 'Job cannot be cancelled' })
  }

  job.status = 'cancelled'
  job.currentStep = null
  job.waitingStep = null
  job.waitingImage = null

  // Kill running python process if any
  const proc = runningProcs.get(job.id)
  if (proc) {
    proc.kill('SIGTERM')
    runningProcs.delete(job.id)
  }

  // Trigger queue — a slot may have freed up
  processNext()
  res.json({ ok: true })
})

// --- Cancel all active jobs ---

app.post('/api/jobs/cancel-all', (_req, res) => {
  const cancellable = ['pending', 'processing', 'waiting_input']
  let count = 0
  for (const job of jobs.values()) {
    if (!cancellable.includes(job.status)) continue
    job.status = 'cancelled'
    job.currentStep = null
    job.waitingStep = null
    job.waitingImage = null
    const proc = runningProcs.get(job.id)
    if (proc) {
      proc.kill('SIGTERM')
      runningProcs.delete(job.id)
    }
    count++
  }
  res.json({ ok: true, cancelled: count })
})

// --- Nettoyage automatique des fichiers anciens ---

const CLEANUP_INTERVAL_MS = (parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 2) * 60 * 60 * 1000
const CLEANUP_MAX_AGE_MS = (parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 2) * 60 * 60 * 1000

function cleanupOldFiles() {
  const now = Date.now()
  let removed = 0
  for (const dir of [UPLOADS_DIR, RESULTS_DIR]) {
    let files
    try { files = readdirSync(dir) } catch { continue }
    for (const file of files) {
      if (file === '.gitkeep') continue
      const filePath = path.join(dir, file)
      try {
        const { mtimeMs } = statSync(filePath)
        if (now - mtimeMs > CLEANUP_MAX_AGE_MS) {
          unlinkSync(filePath)
          removed++
        }
      } catch {}
    }
  }
  // Purger les références en mémoire vers des fichiers supprimés
  for (const [id, photo] of photos) {
    if (!existsSync(path.join(UPLOADS_DIR, photo.filename))) photos.delete(id)
  }
  for (const [id, job] of jobs) {
    if (job.result && !existsSync(path.join(ROOT, job.result.replace(/^\//, '')))) jobs.delete(id)
  }
  if (removed > 0) console.log(`Nettoyage : ${removed} fichier(s) supprimé(s)`)
}

if (CLEANUP_INTERVAL_MS > 0) {
  setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS)
  console.log(`Nettoyage auto : toutes les ${CLEANUP_INTERVAL_MS / 3600000}h, fichiers > ${CLEANUP_MAX_AGE_MS / 3600000}h`)
}

const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`AI ready: ${isAiReady() ? 'YES' : 'NO — setup ' + (isSetupRunning() ? 'in progress...' : 'not started')}`)
})
