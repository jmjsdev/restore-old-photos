// ═══════════════════════════════════════════
//  ÉTAPES DISPONIBLES — commenter pour désactiver
// ═══════════════════════════════════════════
import crop from './crop.js'
import inpaint from './inpaint.js'
import spot_removal from './spot_removal.js'
import scratch_removal from './scratch_removal.js'
import face_restore from './face_restore.js'
import colorize from './colorize.js'
import upscale from './upscale.js'
import online_restore from './online_restore.js'

const ALL_STEPS = {
  crop, inpaint, spot_removal, scratch_removal,
  face_restore, colorize, upscale, online_restore,
}

// Filtrage auto (API keys manquantes, disabled)
export const STEPS = Object.fromEntries(
  Object.entries(ALL_STEPS).filter(([_, s]) => {
    if (s.disabled) return false
    if (s.requiresApiKey && !process.env[s.requiresApiKey]) return false
    return true
  })
)

export const MANUAL_STEPS = new Set(
  Object.entries(STEPS).filter(([_, s]) => s.manual).map(([k]) => k)
)
