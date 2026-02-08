export default {
  name: 'Nettoyage des taches',
  model: 'Multi-échelle + LaMa',
  repo: 'https://github.com/advimman/lama',
  script: 'clean_spots.py',
  prefix: 'SPOTS',
  models: {
    lama: { name: 'LaMa (IA)', desc: 'Détection multi-échelle + inpainting IA' },
    opencv: { name: 'OpenCV', desc: 'Détection multi-échelle + Navier-Stokes (rapide)' },
  },
  defaultModel: 'lama',

  buildArgs({ inputPath, outputPath, job, selectedModel }) {
    return { script: 'clean_spots.py', args: [inputPath, outputPath, selectedModel] }
  },
}
