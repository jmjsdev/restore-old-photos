import { Router } from 'express'
import { randomUUID } from 'crypto'
import { existsSync, copyFileSync } from 'fs'
import path from 'path'
import { UPLOADS_DIR, RESULTS_DIR } from '../config.js'
import { photos } from '../storage.js'
import { upload } from '../upload.js'
import { sanitizeFilename } from '../utils.js'
import { runPythonStep } from '../python.js'

const router = Router()

router.post('/', (req, res) => {
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

router.get('/', (_req, res) => {
  res.json([...photos.values()])
})

router.delete('/:id', (req, res) => {
  photos.delete(req.params.id)
  res.json({ ok: true })
})

router.delete('/', (_req, res) => {
  photos.clear()
  res.json({ ok: true })
})

// --- Import result as new photo ---

router.post('/import', (req, res) => {
  const { resultPath } = req.body
  if (!resultPath) return res.status(400).json({ error: 'resultPath is required' })

  let srcFile = null
  const clean = resultPath.replace(/^\//, '')
  if (clean.startsWith('results/')) {
    srcFile = path.join(RESULTS_DIR, clean.slice('results/'.length))
  } else if (clean.startsWith('uploads/')) {
    srcFile = path.join(UPLOADS_DIR, clean.slice('uploads/'.length))
  }

  // Vérification de sécurité
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

// --- Apply crop immediately ---

router.post('/:id/crop', async (req, res) => {
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

export default router
