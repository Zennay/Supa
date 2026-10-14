import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const SOURCE = 'only-fictional-source'
const STORE = 'fictional-store'
const URL_LITERAL = 'https://example.invalid/offline'
const LIMIT = 8 * 1024 * 1024
const tinyHtml = '<!doctype html><html><body>fictional fixture</body></html>'
const hugeHtml = '<!doctype html><html><body>' + 'x'.repeat(LIMIT) + '</body></html>'

// Genuine local SHA-256 binding avoids a false RED due to missing input data.
// No retailer HTTP request, prices, real sources, credentials or participants.
async function capture(root, label, html, success = true) {
  const directory = join(root, label)
  const htmlDir = join(directory, STORE)
  await mkdir(htmlDir, { recursive: true })
  const file = join(htmlDir, SOURCE + '.html')
  const manifest = join(directory, 'manifest.json')
  if (success) await writeFile(file, html)
  const row = {
    id: SOURCE, supermarket: STORE, kind: 'product',
    requestedUrl: URL_LITERAL, capturedAt: '2026-10-13T00:00:00.000Z',
    success,
    ...(success ? { sha256: createHash('sha256').update(html).digest('hex') } : {}),
  }
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: 1, results: [row],
  })
  await writeFile(manifest, raw)
  return { directory, file, manifest, raw, sha: success ? row.sha256 : null,
    bytes: success ? Buffer.byteLength(html, 'utf8') : 0 }
}

function run(current, baseline) {
  const outcome = spawnSync(process.execPath,
    ['--experimental-strip-types', cli, current.directory,
      ...(baseline ? [baseline.directory] : [])], {
      encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    })
  assert.equal(outcome.error, undefined, 'CLI must terminate without timeout or spawn failure')
  assert.equal(outcome.signal, null, 'CLI must exit cleanly rather than be killed')
  return outcome
}

async function unchanged(...captures) {
  for (const capture of captures) {
    assert.equal(await readFile(capture.manifest, 'utf8'), capture.raw)
    if (capture.sha) {
      assert.equal((await stat(capture.file)).size, capture.bytes)
      assert.equal(createHash('sha256').update(await readFile(capture.file)).digest('hex'),
        capture.sha, 'SHA-bound source file must remain intact')
    }
  }
}

function manualOnly(result, priority) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const output = JSON.parse(result.stdout)
  assert.equal(output.actions.length, 1)
  assert.equal(output.actions[0].priority, priority)
  assert.equal(output.selectorVerified, false)
  assert.equal(output.rightsVerified, false)
  assert.equal(output.productionReady, false)
  assert.equal(output.m5Eligible, false)
  assert.equal(output.actions[0].productionEnabled, false)
  assert.doesNotMatch(result.stdout, /only-fictional-source|fictional-store|example\.invalid/)
}

function rejectsOversized(result) {
  assert.notEqual(result.status, 0,
    'oversized SHA-verified HTML must not be accepted by the offline M5 CLI')
  assert.equal(result.stdout, '', 'no JSON review queue may be emitted')
  assert.match(result.stderr, /^Offline review failed: invalid capture or report\n$/)
  assert.doesNotMatch(result.stderr, /only-fictional-source|fictional-store|example\.invalid|supa-m5-html-budget/)
}

test('positive: canonical small SHA-verified HTML remains a private P2 manual-review source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-html-budget-'))
  try {
    const current = await capture(root, 'small', tinyHtml)
    manualOnly(run(current), 'P2')
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('positive: canonical failed capture remains conservatively P1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-html-budget-'))
  try {
    const current = await capture(root, 'failed', '', false)
    manualOnly(run(current), 'P1')
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2165: small manifest cannot authorize unbounded SHA-verified current HTML', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-html-budget-'))
  try {
    const current = await capture(root, 'oversized-current', hugeHtml)
    assert.ok(current.bytes > LIMIT)
    assert.ok(Buffer.byteLength(current.raw) < 2048)
    rejectsOversized(run(current))
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2165: oversized SHA-verified baseline HTML must also fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-html-budget-'))
  try {
    const current = await capture(root, 'current', tinyHtml)
    const baseline = await capture(root, 'oversized-baseline', hugeHtml)
    assert.ok(baseline.bytes > LIMIT)
    rejectsOversized(run(current, baseline))
    await unchanged(current, baseline)
  } finally { await rm(root, { recursive: true, force: true }) }
})
