import { unlinkSync } from 'fs'

export default {
  name: 'Retouche manuelle',
  model: 'LaMa (WACV 2022)',
  repo: 'https://github.com/advimman/lama',
  script: 'inpaint.py',
  prefix: 'INPAINT',
  manual: true,
  needsMask: true,

  needsInput(job) {
    return !job.maskPath
  },

  buildArgs({ inputPath, outputPath, job }) {
    return { script: 'inpaint.py', args: [inputPath, job.maskPath, outputPath] }
  },

  onComplete(job) {
    if (job.maskPath) {
      try { unlinkSync(job.maskPath) } catch {}
      job.maskPath = null
    }
  },
}
