export default {
  name: 'Restauration des visages',
  model: 'GFPGAN v1.4',
  repo: 'https://github.com/TencentARC/GFPGAN',
  script: 'face_restore.py',
  prefix: 'FACE',

  buildArgs({ inputPath, outputPath }) {
    return { script: 'face_restore.py', args: [inputPath, outputPath] }
  },
}
