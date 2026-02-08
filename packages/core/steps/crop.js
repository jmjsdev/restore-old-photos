export default {
  name: 'Recadrage',
  model: 'Manuel',
  repo: '',
  script: 'crop.py',
  prefix: 'CROP',
  manual: true,

  needsInput(job) {
    return !job.cropRect
  },

  buildArgs({ inputPath, outputPath, job }) {
    return { script: 'crop.py', args: [inputPath, outputPath, job.cropRect] }
  },

  onComplete(job) {
    job.cropRect = null
  },
}
