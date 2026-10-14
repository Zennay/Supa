import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const html = '<!doctype html><html><body>fictional local temporal baseline</body></html>'
const sha = createHash('sha256').update(html).digest('hex')
const store = 'fictional-store'
const id = 'fictional-product'

async function captured(root, name, observedAt) {
  const dir = join(root, name)
  await mkdir(join(dir, store), { recursive: true })
  const htmlPath = join(dir, store, id + '.html')
  const manifestPath = join(dir, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id, supermarket: store, kind: 'product', success: true,
      requestedUrl: 'https://example.invalid/only-fictional',
      capturedAt: observedAt, sha256: sha,
    }],
  })
  await writeFile(htmlPath, html)
  await writeFile(manifestPath, raw)
  return { dir, manifestPath, htmlPath, raw }
}

function run(current, baseline = null) {
  const args = ['--experimental-strip-types', cli, current, ...(baseline ? [baseline] : [])]
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  })
  assert.equal(result.error, undefined, 'timeout may not count as a valid refusal')
  assert.equal(result.signal, null, 'signal termination is not an input-validation failure')
  return result
}

async function preserved(...records) {
  for (const record of records) {
    assert.equal(await readFile(record.manifestPath, 'utf8'), record.raw)
    assert.equal(await readFile(record.htmlPath, 'utf8'), html)
  }
}

function assertHumanOnly(result, priority, status, baselineProvided) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const queue = JSON.parse(result.stdout)
  assert.equal(queue.baselineProvided, baselineProvided)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, priority)
  assert.equal(queue.actions[0].status, status)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.equal(queue.actions[0].productionEnabled, false)
  assert.doesNotMatch(result.stdout,
    /fictional-store|fictional-product|example\.invalid|fictional local temporal/)
}

function assertNoForgedHistory(result) {
  assert.notEqual(result.status, 0,
    'same underlying current and baseline root must not create P3 temporal evidence')
  assert.equal(result.stdout, '', 'invalid self-baseline may not publish JSON queue')
  assert.match(result.stderr, /^Offline review failed: invalid capture or report\n$/)
  assert.doesNotMatch(result.stderr,
    /fictional-store|fictional-product|example\.invalid|supa-m5-self-baseline/)
}

test('positive: one regular SHA-bound capture without baseline retains conservative P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-self-baseline-'))
  try {
    const only = await captured(root, 'current', '2026-10-13T10:00:00.000Z')
    assertHumanOnly(run(only.dir), 'P2', 'baseline_missing', false)
    await preserved(only)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('positive: separate real directory roots with identical fictional HTML can be manually P3', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-self-baseline-'))
  try {
    const before = await captured(root, 'before', '2026-10-12T10:00:00.000Z')
    const now = await captured(root, 'now', '2026-10-13T10:00:00.000Z')
    assertHumanOnly(run(now.dir, before.dir), 'P3', 'unchanged', true)
    await preserved(before, now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2170: same current directory passed twice cannot be P3 historical proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-self-baseline-'))
  try {
    const now = await captured(root, 'current', '2026-10-13T10:00:00.000Z')
    assertNoForgedHistory(run(now.dir, now.dir))
    await preserved(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2170: lexical dot-alias resolving to same root cannot be a distinct baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-self-baseline-'))
  try {
    const now = await captured(root, 'current', '2026-10-13T10:00:00.000Z')
    assertNoForgedHistory(run(now.dir, join(now.dir, '.')))
    await preserved(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})
