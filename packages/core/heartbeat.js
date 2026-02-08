import { HEARTBEAT_TIMEOUT_MS } from './config.js'
import { jobs, runningProcs } from './storage.js'

export let lastHeartbeat = Date.now()

export function touchHeartbeat() {
  lastHeartbeat = Date.now()
}

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

export function startHeartbeatTimer() {
  return setInterval(checkHeartbeat, 5000)
}
