import { Router } from 'express'
import express from 'express'
import { MAX_CONCURRENT_LIMIT } from '../config.js'
import { maxConcurrent, setMaxConcurrent } from '../queue.js'
import { processNext } from '../queue.js'

const router = Router()

router.get('/', (_req, res) => {
  res.json({ maxConcurrent, maxConcurrentLimit: MAX_CONCURRENT_LIMIT })
})

router.put('/', express.json(), (req, res) => {
  const val = req.body.maxConcurrent
  if (typeof val === 'number' && val >= 1 && val <= MAX_CONCURRENT_LIMIT) {
    setMaxConcurrent(Math.round(val))
  }
  processNext()
  res.json({ maxConcurrent, maxConcurrentLimit: MAX_CONCURRENT_LIMIT })
})

export default router
