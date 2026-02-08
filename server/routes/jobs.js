import { Router } from 'express'
import express from 'express'
import { randomUUID } from 'crypto'
import { writeFileSync, unlinkSync } from 'fs'
import path from 'path'
import { UPLOADS_DIR, ROOT } from '../config.js'
import { photos, jobs, runningProcs } from '../storage.js'
import { STEPS, MANUAL_STEPS } from '../steps/index.js'
import { isAiReady, isSetupRunning } from '../python.js'
import { enqueueJob, processJob, processNext } from '../queue.js'
import { touchHeartbeat } from '../heartbeat.js'

const router = Router()

// --- Reorder (must be before /:id) ---

router.put('/reorder', express.json(), (req, res) => {
  const { jobIds } = req.body
  if (!Array.isArray(jobIds)) return res.status(400).json({ error: 'jobIds array required' })

  jobIds.forEach((id, index) => {
    const job = jobs.get(id)
    if (job && job.status === 'pending') {
      job.priority = index
    }
  })
  res.json({ ok: true })
})

// --- Cancel all ---

router.post('/cancel-all', (_req, res) => {
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

// --- Create jobs ---

router.post('/', express.json({ limit: '50mb' }), (req, res) => {
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

  const validSteps = steps.filter((s) => STEPS[s])
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

// --- List jobs ---

router.get('/', (_req, res) => {
  touchHeartbeat()
  const all = [...jobs.values()]
  const statusOrder = { waiting_input: -1, processing: 0, pending: 1, completed: 2, failed: 2, cancelled: 2 }
  all.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 3
    const sb = statusOrder[b.status] ?? 3
    if (sa !== sb) return sa - sb
    if (a.status === 'pending' && b.status === 'pending') {
      return (a.priority || 0) - (b.priority || 0)
    }
    return new Date(b.createdAt) - new Date(a.createdAt)
  })
  res.json(all.map((job) => {
    const { maskPath, cropRect, currentInputPath, ...rest } = job
    if (rest.status === 'waiting_input' && rest.resumeFromStep != null) {
      rest.canGoBack = false
      for (let i = rest.resumeFromStep - 1; i >= 0; i--) {
        if (MANUAL_STEPS.has(job.steps[i])) { rest.canGoBack = true; break }
      }
    }
    return rest
  }))
})

// --- Get single job ---

router.get('/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  res.json(job)
})

// --- Submit input for a waiting job ---

router.post('/:id/input', express.json({ limit: '50mb' }), (req, res) => {
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

router.post('/:id/skip', express.json(), (req, res) => {
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

router.post('/:id/back', express.json(), (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'waiting_input') {
    return res.status(400).json({ error: 'Job is not waiting for input' })
  }

  const currentIdx = job.resumeFromStep || 0

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

router.post('/:id/retry', express.json(), (req, res) => {
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

router.post('/:id/skip-failed', express.json(), (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'failed') {
    return res.status(400).json({ error: 'Job is not in failed state' })
  }

  const nextIndex = (job.failedStepIndex ?? 0) + 1
  job.error = null
  job.failedStep = null
  job.failedStepIndex = null

  if (nextIndex >= job.steps.length) {
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

router.post('/:id/cancel', (req, res) => {
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

  const proc = runningProcs.get(job.id)
  if (proc) {
    proc.kill('SIGTERM')
    runningProcs.delete(job.id)
  }

  processNext()
  res.json({ ok: true })
})

export default router
