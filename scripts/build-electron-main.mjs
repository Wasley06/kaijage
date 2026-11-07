import { build } from 'esbuild'

await build({
  entryPoints: ['electron/main.cjs'],
  outfile: 'assets/generated/electron-main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'bundle',
  external: ['electron'],
  sourcemap: false,
})

console.log('Bundled the Electron updater into the packaged main process.')
