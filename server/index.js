import dotenv from 'dotenv'
dotenv.config({ path: ['.env.local', '.env'] })

import express from 'express'
import { PORT, UPLOADS_DIR, RESULTS_DIR, DIST_DIR } from './config.js'
import { isAiReady, isSetupRunning } from './python.js'
import { startHeartbeatTimer } from './heartbeat.js'
import { startCleanupTimer } from './cleanup.js'

import photosRouter from './routes/photos.js'
import jobsRouter from './routes/jobs.js'
import settingsRouter from './routes/settings.js'
import statusRouter from './routes/status.js'

const app = express()
app.use(express.json())

// Static files
app.use(express.static(DIST_DIR))
app.use('/uploads', express.static(UPLOADS_DIR))
app.use('/results', express.static(RESULTS_DIR))

// API routes
app.use('/api/photos', photosRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api', statusRouter)

// Timers
startHeartbeatTimer()
startCleanupTimer()

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`AI ready: ${isAiReady() ? 'YES' : 'NO — setup ' + (isSetupRunning() ? 'in progress...' : 'not started')}`)
})
