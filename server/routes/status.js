import { Router } from 'express'
import path from 'path'
import { UPLOADS_DIR, AI_DIR } from '../config.js'
import { photos } from '../storage.js'
import { STEPS } from '../steps/index.js'
import { isAiReady, isSetupRunning, getSetupLog, getSetupError, getPython } from '../python.js'

const router = Router()

router.get('/status', async (_req, res) => {
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

router.get('/steps', (_req, res) => {
  // Build the same shape as old STEP_MODELS — expose metadata without internal fields
  const filtered = {}
  for (const [key, step] of Object.entries(STEPS)) {
    filtered[key] = {
      name: step.name,
      model: step.model,
      repo: step.repo,
      script: step.script,
      ...(step.needsMask ? { needsMask: true } : {}),
      ...(step.models ? { models: step.models, defaultModel: step.defaultModel } : {}),
      ...(step.requiresApiKey ? { requiresApiKey: step.requiresApiKey } : {}),
    }
  }
  res.json(filtered)
})

router.get('/auto-crop/:photoId', async (req, res) => {
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

export default router
