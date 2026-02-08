export default {
  name: 'Suppression des rayures',
  model: 'BOPBTL + LaMa',
  repo: 'https://github.com/advimman/lama',
  script: 'restore.py',
  prefix: 'REST',
  models: {
    lama: { name: 'LaMa (IA)', desc: 'Meilleure qualité, plus lent (~200MB)' },
    opencv: { name: 'OpenCV', desc: 'Rapide, Navier-Stokes' },
  },
  defaultModel: 'lama',

  buildArgs({ inputPath, outputPath, job, selectedModel }) {
    return { script: 'restore.py', args: [inputPath, outputPath, selectedModel] }
  },
}
