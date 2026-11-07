import { spawnSync } from 'node:child_process'

for (const args of [
  ['scripts/build-icons.mjs'],
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.ts'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
