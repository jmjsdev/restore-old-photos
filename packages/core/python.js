import { existsSync, readFileSync } from 'fs'
import { execFile } from 'child_process'
import path from 'path'
import { AI_DIR, VENV_PYTHON, SETUP_PID_FILE, SETUP_LOG_FILE, SETUP_ERROR_FILE } from './config.js'
import { runningProcs } from './storage.js'

export function getPython() {
  if (existsSync(VENV_PYTHON)) return VENV_PYTHON
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function isAiReady() {
  return existsSync(VENV_PYTHON)
}

export function isSetupRunning() {
  if (!existsSync(SETUP_PID_FILE)) return false
  try {
    const pid = parseInt(readFileSync(SETUP_PID_FILE, 'utf8').trim())
    process.kill(pid, 0) // test if process exists
    return true
  } catch {
    return false
  }
}

export function getSetupError() {
  try {
    return readFileSync(SETUP_ERROR_FILE, 'utf8').trim()
  } catch {
    return null
  }
}

export function getSetupLog() {
  try {
    const log = readFileSync(SETUP_LOG_FILE, 'utf8')
    const lines = log.trim().split('\n').filter(l => l.startsWith('[setup'))
    const last = lines[lines.length - 1] || ''
    const match = last.match(/^\[setup (\d+)\/(\d+)\]\s*(.*)$/)
    if (match) return { step: parseInt(match[1]), total: parseInt(match[2]), message: match[3] }
    if (last.includes('[setup done]')) return { step: -1, total: -1, message: last.replace('[setup done] ', '') }
    return { step: 0, total: 0, message: last }
  } catch {
    return { step: 0, total: 0, message: '' }
  }
}

export function runPythonStep(script, args, jobId) {
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
