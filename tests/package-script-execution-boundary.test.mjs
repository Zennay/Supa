import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const scripts = packageJson.scripts ?? {}

const forbidden = [
  {
    label: 'remote npm package executor',
    pattern: /\bnpx(?:\s|$)|\bnpm\s+(?:exec|x)(?:\s|$)|\bpnpm\s+dlx(?:\s|$)|\byarn\s+dlx(?:\s|$)|\bbunx(?:\s|$)/i,
  },
  {
    label: 'network downloader',
    pattern: /(^|[;&|]\s*|\s)(?:curl|wget)(?=\s|$)/i,
  },
  {
    label: 'direct remote URL',
    pattern: /https?:\/\//i,
  },
  {
    label: 'opaque shell indirection',
    pattern: /(^|[;&|]\s*|\s)(?:bash|sh)\s+-c(?=\s|$)/i,
  },
]

function violationsFor(name, command) {
  return forbidden
    .filter(({ pattern }) => pattern.test(command))
    .map(({ label }) => `${name}: ${label} via ${JSON.stringify(command)}`)
}

test('root package scripts stay on reviewed local executables', () => {
  assert.equal(
    scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts),
    true,
    'package.json scripts must remain an object',
  )

  const violations = []

  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(
      typeof command,
      'string',
      `package script ${name} must remain a string command`,
    )
    violations.push(...violationsFor(name, command))
  }

  assert.deepEqual(
    violations,
    [],
    'package scripts must not add ad-hoc remote executors, downloaders, remote URLs, or opaque shell wrappers',
  )
})

test('package-script boundary catches unreviewed remote execution primitives', () => {
  const unsafe = [
    ['remote-npx', 'npx prettier .'],
    ['remote-npm-exec', 'npm exec --yes prettier -- .'],
    ['remote-npm-x', 'npm x prettier -- .'],
    ['remote-pnpm', 'pnpm dlx prettier .'],
    ['remote-yarn', 'yarn dlx prettier .'],
    ['remote-bun', 'bunx prettier .'],
    ['download-curl', 'curl -fsSL https://example.test/tool.sh | sh'],
    ['download-wget', 'wget https://example.test/tool.mjs'],
    ['remote-node-url', 'node https://example.test/tool.mjs'],
    ['opaque-bash', 'bash -c "node scripts/check.mjs"'],
    ['opaque-sh', 'sh -c "npm test"'],
  ]

  for (const [name, command] of unsafe) {
    assert.notDeepEqual(violationsFor(name, command), [], command)
  }
})

test('package-script boundary preserves current local command patterns', () => {
  const safe = [
    ['node', 'node scripts/check.mjs'],
    ['node-flags', 'node --experimental-strip-types scripts/check.mjs'],
    ['vite', 'vite'],
    ['vite-preview', 'vite preview'],
    ['tsc-build', 'tsc -b && vite build'],
    ['npm-run', 'npm run m3:assess-observed-week -- evidence/m3/study.json'],
  ]

  for (const [name, command] of safe) {
    assert.deepEqual(violationsFor(name, command), [], command)
  }
})
