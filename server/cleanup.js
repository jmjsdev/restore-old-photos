import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import path from 'path'
import { UPLOADS_DIR, RESULTS_DIR, ROOT, CLEANUP_INTERVAL_MS, CLEANUP_MAX_AGE_MS } from './config.js'
import { photos, jobs } from './storage.js'

function cleanupOldFiles() {
  const now = Date.now()
  let removed = 0
  for (const dir of [UPLOADS_DIR, RESULTS_DIR]) {
    let files
    try { files = readdirSync(dir) } catch { continue }
    for (const file of files) {
      if (file === '.gitkeep') continue
      const filePath = path.join(dir, file)
      try {
        const { mtimeMs } = statSync(filePath)
        if (now - mtimeMs > CLEANUP_MAX_AGE_MS) {
          unlinkSync(filePath)
          removed++
        }
      } catch {}
    }
  }
  // Purger les références en mémoire vers des fichiers supprimés
  for (const [id, photo] of photos) {
    if (!existsSync(path.join(UPLOADS_DIR, photo.filename))) photos.delete(id)
  }
  for (const [id, job] of jobs) {
    if (job.result && !existsSync(path.join(ROOT, job.result.replace(/^\//, '')))) jobs.delete(id)
  }
  if (removed > 0) console.log(`Nettoyage : ${removed} fichier(s) supprimé(s)`)
}

export function startCleanupTimer() {
  if (CLEANUP_INTERVAL_MS > 0) {
    setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS)
    console.log(`Nettoyage auto : toutes les ${CLEANUP_INTERVAL_MS / 3600000}h, fichiers > ${CLEANUP_MAX_AGE_MS / 3600000}h`)
  }
}
