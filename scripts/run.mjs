import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const [tool, ...requestedArgs] = process.argv.slice(2)

if (!['next', 'payload'].includes(tool)) {
  console.error('Usage: node scripts/run.mjs <next|payload> [arguments...]')
  process.exit(2)
}

const executable = tool === 'next'
  ? require.resolve('next/dist/bin/next')
  : path.resolve(path.dirname(require.resolve('payload')), '..', 'bin.js')
const args = [...requestedArgs]

if (tool === 'next' && ['dev', 'start'].includes(args[0])) {
  args.push('--port', process.env.PORT || '3000', '--hostname', '0.0.0.0')
}

const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--no-deprecation'].filter(Boolean).join(' '),
}
const child = spawn(process.execPath, [executable, ...args], { env, stdio: 'inherit' })

child.on('error', (error) => {
  console.error(`Could not start ${tool}: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
