import path from 'path'
import { RESULTS_DIR } from './config.js'

/** Sanitize filename: remove accents, replace special chars */
export function sanitizeFilename(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
    .replace(/[^a-zA-Z0-9._-]/g, '_')                  // Replace special chars
    .replace(/_+/g, '_')                                // Collapse multiple underscores
    .replace(/^_|_$/g, '')                              // Trim underscores
}

export function getUrlForPath(filePath) {
  if (filePath.startsWith(RESULTS_DIR)) return `/results/${path.basename(filePath)}`
  return `/uploads/${path.basename(filePath)}`
}
