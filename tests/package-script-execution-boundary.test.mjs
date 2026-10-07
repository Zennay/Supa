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

const reviewedDirectExecutables = new Map([
  ['node', null],
  ['npm', null],
  ['vite', 'vite'],
  ['tsc', 'typescript'],
])

function violationsFor(name, command) {
  return forbidden
    .filter(({ pattern }) => pattern.test(command))
    .map(({ label }) => `${name}: ${label} via ${JSON.stringify(command)}`)
}

function commandExecutables(command) {
  return command
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const words = segment.split(/\s+/)
      let index = 0
      while (
        index < words.length &&
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
      ) {
        index += 1
      }
      return words[index] ?? null
    })
    .filter(Boolean)
}

function executableViolationsFor(name, command, manifest = packageJson) {
  const declaredPackages = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])
  const violations = []

  for (const executable of commandExecutables(command)) {
    if (!reviewedDirectExecutables.has(executable)) {
      violations.push(
        `${name}: unreviewed direct executable ${JSON.stringify(executable)}`,
      )
      continue
    }

    const packageName = reviewedDirectExecutables.get(executable)
    if (packageName !== null && !declaredPackages.has(packageName)) {
      violations.push(
        `${name}: ${JSON.stringify(executable)} requires declared package ${JSON.stringify(packageName)}`,
      )
    }
  }

  return violations
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
    violations.push(...executableViolationsFor(name, command))
  }

  assert.deepEqual(
    violations,
    [],
    'package scripts must use reviewed local executables and must not add remote execution or download paths',
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

test('package-script boundary rejects undeclared or globally assumed executables', () => {
  for (const command of [
    'prettier .',
    'python scripts/check.py',
    'git status',
    'node scripts/check.mjs && eslint .',
  ]) {
    assert.notDeepEqual(
      executableViolationsFor('candidate', command),
      [],
      command,
    )
  }

  assert.notDeepEqual(
    executableViolationsFor(
      'candidate',
      'vite build',
      { dependencies: {}, devDependencies: {} },
    ),
    [],
  )
  assert.notDeepEqual(
    executableViolationsFor(
      'candidate',
      'tsc -b',
      { dependencies: {}, devDependencies: {} },
    ),
    [],
  )
})

test('package-script boundary preserves current local command patterns', () => {
  const safe = [
    ['node', 'node scripts/check.mjs'],
    ['node-flags', 'node --experimental-strip-types scripts/check.mjs'],
    ['vite', 'vite'],
    ['vite-preview', 'vite preview'],
    ['tsc-build', 'tsc -b && vite build'],
    ['npm-run', 'npm run m3:assess-observed-week -- evidence/m3/study.json'],
    ['env-prefix', 'NODE_ENV=test vite build'],
  ]

  for (const [name, command] of safe) {
    assert.deepEqual(violationsFor(name, command), [], command)
    assert.deepEqual(executableViolationsFor(name, command), [], command)
  }
})
