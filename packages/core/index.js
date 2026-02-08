// Charger dotenv AVANT les imports de config (qui lisent process.env)
// En ESM, les imports statiques sont évalués avant le code du module,
// donc on utilise des imports dynamiques après dotenv.config()
import path from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Trouver la racine du projet pour charger .env
let envRoot = process.env.OLDPHOTOS_ROOT
if (!envRoot) {
  let dir = __dirname
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'ai'))) { envRoot = dir; break }
    dir = path.dirname(dir)
  }
  if (!envRoot) envRoot = path.join(__dirname, '..', '..')
}
dotenv.config({ path: [path.join(envRoot, '.env.local'), path.join(envRoot, '.env')] })

// Imports dynamiques après dotenv
const { PORT, UPLOADS_DIR, RESULTS_DIR, DIST_DIR } = await import('./config.js')
const { isAiReady, isSetupRunning } = await import('./python.js')
const { startHeartbeatTimer } = await import('./heartbeat.js')
const { startCleanupTimer } = await import('./cleanup.js')

const photosRouter = (await import('./routes/photos.js')).default
const jobsRouter = (await import('./routes/jobs.js')).default
const settingsRouter = (await import('./routes/settings.js')).default
const statusRouter = (await import('./routes/status.js')).default

const { default: express } = await import('express')

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
