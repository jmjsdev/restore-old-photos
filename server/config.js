import path from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.join(__dirname, '..')
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads')
export const RESULTS_DIR = process.env.RESULTS_DIR || path.join(ROOT, 'results')
export const AI_DIR = path.join(ROOT, 'ai')
export const DIST_DIR = path.join(ROOT, 'dist')
export const VENV_PYTHON = path.join(AI_DIR, 'venv', 'bin', 'python')

export const SETUP_PID_FILE = '/data/setup.pid'
export const SETUP_LOG_FILE = '/data/setup.log'
export const SETUP_ERROR_FILE = '/data/setup.error'

export const PORT = process.env.PORT || 3001
export const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_SECONDS || '10') * 1000
export const MAX_CONCURRENT_LIMIT = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS) || 2)
export const CLEANUP_INTERVAL_MS = (parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 2) * 60 * 60 * 1000
export const CLEANUP_MAX_AGE_MS = (parseInt(process.env.CLEANUP_MAX_AGE_HOURS) || 2) * 60 * 60 * 1000

// Ensure directories exist
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
