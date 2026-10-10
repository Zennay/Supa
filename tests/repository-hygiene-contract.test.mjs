import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Issue #723: checkout-only repository hygiene. Never read ignored file
// contents, environment values, tokens, private captures or source evidence.
const root = fileURLToPath(new URL('../', import.meta.url))
const ignoredExamples = [
  '.env', '.env.local', '.env.production', 'src/.env.review',
  '.DS_Store', 'src/.DS_Store',
  '.vscode/settings.json', '.idea/workspace.xml',
  'debug.log', 'logs/runtime.log',
  'tsconfig.app.tsbuildinfo',
  'node_modules/private/index.js', 'dist/index.html',
  'artifacts/m3/derived-private.json',
  'vite.config.js', 'vite.config.d.ts',
]

function isForbiddenTrackedPath(p) {
  const components = p.split('/')
  const basename = components.at(-1) || ''
  if (components.some((v) => v === 'node_modules' || v === 'dist' ||
      v === 'artifacts' || v === '.vscode' || v === '.idea')) return true
  if (components.some((v) => v === '.DS_Store')) return true
  if (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) return true
  if (basename.endsWith('.log') || basename.endsWith('.tsbuildinfo')) return true
  if (p === 'vite.config.js' || p === 'vite.config.d.ts') return true
  return false
}

function invalidPortableSegment(segment) {
  if (!segment || segment === '.' || segment === '..') return true
  if (/[<>:"\\|?*\x00-\x1f]/.test(segment)) return true
  if (/[. ]$/.test(segment)) return true
  // Windows treats a device name as reserved even when an extension follows.
  const stem = segment.split('.')[0]
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)
}

function trackedFailures(entries) {
  const failures = []
  const seen = new Map()
  for (const { path, mode, stage } of entries) {
    if (stage !== '0') failures.push('unmerged index entry')
    if (mode === '120000' || mode === '160000') failures.push('symlink/gitlink entry')
    if (mode !== '100644' && mode !== '100755') failures.push('unsupported git file mode')
    if (isForbiddenTrackedPath(path)) failures.push('forbidden tracked artifact')
    if (path.split('/').some(invalidPortableSegment)) failures.push('nonportable path segment')
    const key = path.normalize('NFC').toLowerCase()
    if (seen.has(key) && seen.get(key) !== path) failures.push('portable path collision')
    seen.set(key, path)
  }
  return failures
}

function trackedEntries() {
  const bytes = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root })
  return bytes.toString('utf8').split('\0').filter(Boolean).map((line) => {
    const match = /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/.exec(line)
    assert.ok(match, 'git index metadata has a parseable stage record')
    return { mode: match[1], stage: match[3], path: match[4] }
  })
}

function gitIgnoreStatus(p) {
  // --no-index makes force-added paths subject to the same ignore-policy probe.
  const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '--', p], {
    cwd: root, encoding: 'utf8',
  })
  assert.equal(result.error, undefined, 'git check-ignore must be callable')
  assert.ok(result.status === 0 || result.status === 1, 'git check-ignore must complete')
  return result.status === 0
}

test('QA #723: reviewed local and secret-adjacent paths stay ignored', () => {
  for (const p of ignoredExamples) {
    assert.equal(gitIgnoreStatus(p), true, `expected ignore policy: ${p}`)
  }
  assert.equal(gitIgnoreStatus('.env.example'), false, 'shareable example must stay trackable')
  assert.equal(gitIgnoreStatus('src/domain/basket.ts'), false)
  assert.equal(gitIgnoreStatus('evidence/m3/template.json'), false,
    'canonical evidence templates are versionable; never inspect their values')
})

test('QA #723: checked-out tracked set has no secret-adjacent artifact or nonportable Git entries', () => {
  const entries = trackedEntries()
  assert.ok(entries.length > 0)
  const failures = trackedFailures(entries)
  assert.deepEqual(failures, [], 'tracked checkout violates reviewed hygiene contract')
})

test('QA #723: synthetic negative fixtures reject forced secrets, paths, symlinks and gitlinks', () => {
  for (const p of [
    'src/.env.local', 'node_modules/hidden.js', 'artifacts/m3/private.json',
    'dist/chunk.js', '.idea/settings.xml', 'vite.config.d.ts',
    'logs/debug.log', 'src/tsconfig.tsbuildinfo',
  ]) {
    assert.ok(trackedFailures([{ path: p, mode: '100644', stage: '0' }]).length > 0, p)
  }
  for (const [mode, path] of [
    ['120000', 'src/data/link.ts'], ['160000', 'packages/submodule'],
  ]) {
    assert.ok(trackedFailures([{ mode, path, stage: '0' }]).length > 0, path)
  }
  for (const p of ['src/CON.ts', 'docs/nul.md', 'src/trailing. ', 'src/x?.ts', 'src/with\\slash']) {
    assert.ok(trackedFailures([{ path: p, mode: '100644', stage: '0' }]).length > 0, p)
  }
  assert.ok(trackedFailures([
    { path: 'src/Foo.ts', mode: '100644', stage: '0' },
    { path: 'src/foo.ts', mode: '100644', stage: '0' },
  ]).includes('portable path collision'))
  assert.ok(trackedFailures([
    { path: 'docs/café.md', mode: '100644', stage: '0' },
    { path: 'docs/cafe\u0301.md', mode: '100644', stage: '0' },
  ]).includes('portable path collision'))
})

test('QA #723: reviewed normal paths and explicit .env.example stay admissible', () => {
  assert.deepEqual(trackedFailures([
    { path: '.env.example', mode: '100644', stage: '0' },
    { path: 'src/domain/basket.ts', mode: '100644', stage: '0' },
    { path: 'docs/REVIEW.md', mode: '100644', stage: '0' },
    { path: '.github/workflows/ci.yml', mode: '100644', stage: '0' },
  ]), [])
})
