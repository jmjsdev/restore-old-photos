export default {
  name: 'Colorisation',
  model: 'DDColor (ICCV 2023)',
  repo: 'https://github.com/piddnad/DDColor',
  script: 'colorize_ddcolor.py',
  prefix: 'COL',
  models: {
    ddcolor: { name: 'DDColor', desc: 'ICCV 2023 - meilleure qualité (~912MB)' },
    deoldify_artistic: { name: 'DeOldify Artistic', desc: 'Couleurs vibrantes, idéal pour portraits (~255MB)' },
    deoldify_stable: { name: 'DeOldify Stable', desc: 'Couleurs conservatrices, plus cohérent (~834MB)' },
    siggraph17: { name: 'Siggraph17', desc: 'Zhang et al. 2017 - rapide (~130MB)' },
    eccv16: { name: 'ECCV16', desc: 'Zhang et al. 2016 - classique (~130MB)' },
  },
  defaultModel: 'ddcolor',

  buildArgs({ inputPath, outputPath, job, selectedModel }) {
    if (selectedModel === 'ddcolor') {
      return { script: 'colorize_ddcolor.py', args: [inputPath, outputPath] }
    }
    if (selectedModel === 'deoldify_artistic') {
      return { script: 'colorize_deoldify.py', args: [inputPath, outputPath, 'artistic'] }
    }
    if (selectedModel === 'deoldify_stable') {
      return { script: 'colorize_deoldify.py', args: [inputPath, outputPath, 'stable'] }
    }
    // siggraph17, eccv16
    return { script: 'colorize.py', args: [inputPath, outputPath, selectedModel] }
  },
}
