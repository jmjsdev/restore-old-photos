export default {
  name: 'Upscale x2',
  model: 'Real-ESRGAN x4plus',
  repo: 'https://github.com/xinntao/Real-ESRGAN',
  script: 'upscale.py',
  prefix: 'UPS',
  models: {
    compact: { name: 'Real-ESRGAN Compact', desc: 'Rapide, bonne qualité (~1MB)' },
    x4plus: { name: 'Real-ESRGAN x4plus', desc: 'Polyvalent, meilleure qualité (~64MB)' },
    'x4plus-anime': { name: 'Real-ESRGAN Anime', desc: 'Optimisé illustrations (~17MB)' },
    x2plus: { name: 'Real-ESRGAN x2plus', desc: 'Upscale natif x2 (~64MB)' },
    lanczos: { name: 'Lanczos (sans IA)', desc: 'Instantané, interpolation classique' },
  },
  defaultModel: 'compact',

  buildArgs({ inputPath, outputPath, job, selectedModel }) {
    return { script: 'upscale.py', args: [inputPath, outputPath, selectedModel, '2'] }
  },
}
