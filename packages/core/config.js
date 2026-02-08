import path from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isWin = process.platform === 'win32'

// Résolution du ROOT :
// 1. Env var OLDPHOTOS_ROOT (posé par Tauri, Docker, ou l'utilisateur)
// 2. Remonte depuis __dirname jusqu'à trouver ai/
// 3. Fallback : deux niveaux au-dessus de packages/core/
function resolveRoot() {
  if (process.env.OLDPHOTOS_ROOT) return path.resolve(process.env.OLDPHOTOS_ROOT)
  let dir = __dirname
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'ai'))) return dir
    dir = path.dirname(dir)
  }
  return path.join(__dirname, '..', '..')
}

export const ROOT = resolveRoot()
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads')
export const RESULTS_DIR = process.env.RESULTS_DIR || path.join(ROOT, 'results')
export const AI_DIR = process.env.AI_DIR || path.join(ROOT, 'ai')
export const DIST_DIR = process.env.DIST_DIR || path.join(ROOT, 'packages', 'frontend', 'dist')
export const VENV_PYTHON = path.join(AI_DIR, 'venv',
  isWin ? 'Scripts' : 'bin',
  isWin ? 'python.exe' : 'python')

export const SETUP_PID_FILE = process.env.SETUP_PID_FILE || '/data/setup.pid'
export const SETUP_LOG_FILE = process.env.SETUP_LOG_FILE || '/data/setup.log'
export const SETUP_ERROR_FILE = process.env.SETUP_ERROR_FILE || '/data/setup.error'

export const PORT = process.env.PORT || 3001
export const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_SECONDS || '10') * 1000
export const MAX_CONCURRENT_LIMIT = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS) || 2)
export const CLEANUP_INTERVAL_MS = (parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 2) * 60 * 60 * 1000
export const CLEANUP_MAX_AGE_MS = (parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 2) * 60 * 60 * 1000

// Ensure directories exist
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
