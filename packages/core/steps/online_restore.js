const ONLINE_STEPS_MAP = {
  full: 'restore,colorize,enhance',
  restore: 'restore',
  colorize: 'colorize',
  enhance: 'enhance',
}

export default {
  name: 'IA en ligne (OpenAI)',
  model: 'GPT-4o Image',
  repo: 'https://platform.openai.com/docs/guides/images',
  script: 'restore_openai.py',
  prefix: 'CLOUD',
  models: {
    full: { name: 'Restauration complète', desc: 'Répare + colorise + améliore (tout-en-un)' },
    restore: { name: 'Restauration seule', desc: 'Supprime rayures et taches uniquement' },
    colorize: { name: 'Colorisation', desc: 'Colorise en couleurs réalistes' },
    enhance: { name: 'Amélioration', desc: 'Netteté, contraste, détails' },
  },
  defaultModel: 'full',
  requiresApiKey: 'OPENAI_API_KEY',
  disabled: true,

  buildArgs({ inputPath, outputPath, job, selectedModel }) {
    const steps = ONLINE_STEPS_MAP[selectedModel] || selectedModel
    return { script: 'restore_openai.py', args: [inputPath, outputPath, steps] }
  },
}
