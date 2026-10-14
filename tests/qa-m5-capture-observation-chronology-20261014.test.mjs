import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// QA-only temporal provenance contract for frozen future-M5 owner #2162.
// All source names and HTML are fictitious; no network, prices or credentials.
const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const document = '<!doctype html><html><body>synthetic private-local observation</body></html>'
const sha = createHash('sha256').update(document).digest('hex')
const id = 'fictional-capture'
const shop = 'fictional-store'

async function fixture(root, label, capturedAt = '2026-10-13T10:00:00.000Z') {
  const folder = join(root, label)
  await mkdir(join(folder, shop), { recursive: true })
  const htmlPath = join(folder, shop, id + '.html')
  const manifestPath = join(folder, 'manifest.json')
  const record = {
    id, supermarket: shop, kind: 'product', success: true,
    requestedUrl: 'https://example.invalid/fictional',
    sha256: sha,
  }
  if (capturedAt !== 'OMIT') record.capturedAt = capturedAt
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: 1, results: [record],
  })
  await writeFile(htmlPath, document)
  await writeFile(manifestPath, raw)
  return { folder, htmlPath, manifestPath, raw }
}

function call(current, previous = null) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, current.folder,
    ...(previous ? [previous.folder] : []),
  ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined, 'a timeout or spawn error is not safe input rejection')
  assert.equal(r.signal, null, 'a signal kill is not safe validation')
  return r
}

async function unchanged(...inputs) {
  for (const input of inputs) {
    assert.equal(await readFile(input.manifestPath, 'utf8'), input.raw)
    assert.equal(await readFile(input.htmlPath, 'utf8'), document)
    assert.equal(
      createHash('sha256').update(await readFile(input.htmlPath)).digest('hex'),
      sha,
    )
  }
}

function noLeak(result) {
  assert.doesNotMatch(result.stdout + result.stderr,
    /fictional-capture|fictional-store|example\.invalid|synthetic private-local|supa-m5-chronology/)
}

function humanOnly(result, expectedPriority, expectedStatus, baselineProvided) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.equal(report.baselineProvided, baselineProvided)
  assert.equal(report.actions.length, 1)
  assert.equal(report.actions[0].priority, expectedPriority)
  assert.equal(report.actions[0].status, expectedStatus)
  assert.equal(report.actions[0].selectorVerified, false)
  assert.equal(report.actions[0].rightsVerified, false)
  assert.equal(report.actions[0].productionEnabled, false)
  assert.equal(report.rightsVerified, false)
  assert.equal(report.selectorVerified, false)
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
  noLeak(result)
}

function refuse(result) {
  assert.notEqual(result.status, 0,
    'untrusted observation chronology must not receive a normal human review status')
  assert.equal(result.stdout, '', 'invalid temporal evidence must not publish JSON review actions')
  assert.equal(result.stderr, 'Offline review failed: invalid capture or report\n')
  noLeak(result)
}

test('positive: valid current capture without baseline remains private P2 manual review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-chronology-'))
  try {
    const current = await fixture(root, 'current')
    humanOnly(call(current), 'P2', 'baseline_missing', false)
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('positive: older independent baseline with identical HTML is private P3 unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-chronology-'))
  try {
    const previous = await fixture(root, 'previous', '2026-10-12T09:00:00.000Z')
    const current = await fixture(root, 'current', '2026-10-13T10:00:00.000Z')
    humanOnly(call(current, previous), 'P3', 'unchanged', true)
    await unchanged(current, previous)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2173: newer baseline snapshot must not masquerade as historical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-chronology-'))
  try {
    const previous = await fixture(root, 'future-baseline', '2026-10-13T11:00:00.000Z')
    const current = await fixture(root, 'current', '2026-10-13T10:00:00.000Z')
    refuse(call(current, previous))
    await unchanged(current, previous)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2173: same observation instant with different timezone spellings is not a prior baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-chronology-'))
  try {
    const previous = await fixture(root, 'previous', '2026-10-13T11:00:00+01:00')
    const current = await fixture(root, 'current', '2026-10-13T10:00:00Z')
    refuse(call(current, previous))
    await unchanged(current, previous)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2173: missing capturedAt cannot become a verified current snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-chronology-'))
  try {
    const current = await fixture(root, 'current', 'OMIT')
    refuse(call(current))
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('expected RED #2173: impossible capturedAt date cannot become a verified current snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-chronology-'))
  try {
    const current = await fixture(root, 'current', '2026-99-99T10:00:00Z')
    refuse(call(current))
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})
