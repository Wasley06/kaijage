import { spawnSync } from 'node:child_process'

const isFigmaBuild = process.env.FIGMA === '1' || Boolean(process.env.FIGMA_EID)
const args = isFigmaBuild
  ? ['scripts/run.mjs', 'payload', 'build']
  : ['scripts/build-standalone.mjs']

const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
