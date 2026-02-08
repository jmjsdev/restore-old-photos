import path from 'path'
import { UPLOADS_DIR, RESULTS_DIR, MAX_CONCURRENT_LIMIT } from './config.js'
import { photos, jobs } from './storage.js'
import { STEPS, MANUAL_STEPS } from './steps/index.js'
import { runPythonStep } from './python.js'
import { sanitizeFilename, getUrlForPath } from './utils.js'

export let maxConcurrent = MAX_CONCURRENT_LIMIT

export function setMaxConcurrent(val) {
  maxConcurrent = val
}

export function enqueueJob(job) {
  processNext()
}

function jobHasManualSteps(job) {
  return job.steps.some(s => MANUAL_STEPS.has(s))
}

/** Vérifie si le prochain step d'un job va immédiatement se mettre en waiting_input */
function jobWillPauseImmediately(job) {
  const idx = job.resumeFromStep || 0
  const step = job.steps[idx]
  const stepDef = STEPS[step]
  if (stepDef?.needsInput?.(job)) return true
  return false
}

export function processNext() {
  const allJobs = [...jobs.values()]
  const running = allJobs.filter((j) => j.status === 'processing').length

  // Si un job attend une action manuelle, ne pas lancer d'autre job avec étapes manuelles
  const hasWaitingManual = allJobs.some(j => j.status === 'waiting_input')

  const pending = allJobs
    .filter((j) => j.status === 'pending')
    .filter((j) => !hasWaitingManual || !jobHasManualSteps(j))
    .sort((a, b) => (a.priority || 0) - (b.priority || 0))

  let slotsUsed = 0
  for (const job of pending) {
    const willPause = jobWillPauseImmediately(job)
    // Les jobs qui vont immédiatement se mettre en pause ne consomment pas de slot
    if (!willPause && running + slotsUsed >= maxConcurrent) continue
    if (!willPause) slotsUsed++
    processJob(job).then(() => processNext())
  }
}

export async function processJob(job) {
  job.status = 'processing'
  const photo = photos.get(job.photoId)
  if (!photo) {
    job.status = 'failed'
    return
  }

  const origName = sanitizeFilename(path.parse(photo.originalName).name)
  const jobShort = job.id.slice(0, 6)

  const startIndex = job.resumeFromStep || 0
  let currentInput = job.currentInputPath || path.join(UPLOADS_DIR, photo.filename)

  try {
    for (let i = startIndex; i < job.steps.length; i++) {
      const step = job.steps[i]
      const stepDef = STEPS[step]
      if (!stepDef) continue

      // Pause at manual steps needing input
      if (stepDef.needsInput?.(job)) {
        job.status = 'waiting_input'
        job.waitingStep = step
        job.resumeFromStep = i
        job.currentInputPath = currentInput
        job.waitingImage = getUrlForPath(currentInput)
        job.progress = Math.round((i / job.steps.length) * 100)
        return
      }

      job.currentStep = step
      job.progress = Math.round((i / job.steps.length) * 100)
      console.log(`Job ${job.id} | Step ${i + 1}/${job.steps.length}: ${stepDef.name}`)

      // All outputs are PNG, named consistently
      const prefix = stepDef.prefix || step
      const outputFilename = `${origName}_${prefix}_${jobShort}.png`
      const outputPath = path.join(RESULTS_DIR, outputFilename)

      // Let the step build its own args
      const selectedModel = stepDef.models
        ? (job.options?.[step] || stepDef.defaultModel)
        : null
      const { script, args } = stepDef.buildArgs({
        inputPath: currentInput, outputPath, job, selectedModel,
      })

      // Check cancellation before starting step
      if (job.status === 'cancelled') return

      await runPythonStep(script, args, job.id)

      // Check cancellation after step completes
      if (job.status === 'cancelled') return

      // Clean up after step
      if (stepDef.onComplete) stepDef.onComplete(job)

      // Record step result
      job.stepResults.push({ step, result: `/results/${outputFilename}` })

      currentInput = outputPath
      job.currentInputPath = currentInput

      // Après chaque étape, relancer la queue — permet au prochain job manuel
      // de démarrer pendant que ce job continue ses étapes automatiques
      processNext()
    }

    // Job completed: final result is the last step's output
    job.status = 'completed'
    job.progress = 100
    job.currentStep = null
    job.waitingStep = null
    job.waitingImage = null
    job.result = job.stepResults.length > 0
      ? job.stepResults[job.stepResults.length - 1].result
      : null
  } catch (err) {
    if (job.status === 'cancelled') {
      console.log(`Job ${job.id} cancelled`)
      job.currentStep = null
      return
    }
    console.error(`Job ${job.id} failed at step "${job.currentStep}":`, err.message)
    job.status = 'failed'
    job.error = err.message
    job.failedStep = job.currentStep
    job.failedStepIndex = job.steps.indexOf(job.currentStep)
    job.currentStep = null
  }
}
