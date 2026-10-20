// Starts the API server (port 4174) and the Vite dev server together, so the
// app in `npm run dev:full` talks to the same backend as production. Vite
// already proxies /api to 127.0.0.1:4174 (see vite.config.ts).
import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['--experimental-strip-types', 'server/app.mjs'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of children) child.on('exit', code => stop(code ?? 0))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
