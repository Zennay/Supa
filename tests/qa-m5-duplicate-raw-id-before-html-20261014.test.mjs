import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

// Independent, local-only M5 RAW manifest preflight acceptance. Invalid cohorts
// deliberately omit HTML: the trusted preflight MUST reject before HTML I/O.
// No actual retailer, product IDs, prices, permissions or public M5 use.
const CLI = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const HTML = '<!doctype html><html><body>synthetic tiny observation</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const MARKET = 'fictional-shop'

function row(id, { success = true, at = '2026-10-13T10:00:00.000Z', market = MARKET } = {}) {
  return {
    id, supermarket: market, kind: 'product', success,
    requestedUrl: 'https://example.invalid/synthetic-only',
    ...(success ? { sha256: SHA, capturedAt: at } : {}),
  }
}

async function fixture(root, name, rows, { writeHtml = false } = {}) {
  const dir = join(root, name)
  await mkdir(dir)
  const manifest = join(dir, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility',
    bounded: true,
    sourceCount: rows.length,
    results: rows,
  })
  await writeFile(manifest, raw)
  if (writeHtml) {
    for (const entry of rows) {
      if (!entry.success) continue
      const market = join(dir, entry.supermarket)
      await mkdir(market, { recursive: true })
      await writeFile(join(market, entry.id + '.html'), HTML)
    }
  }
  return { dir, manifest, raw }
}

async function unchanged(...inputs) {
  for (const f of inputs) assert.equal(await readFile(f.manifest, 'utf8'), f.raw)
}

function cli(...dirs) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', CLI, ...dirs], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
  })
  assert.equal(r.error, undefined, 'a timeout is not valid fail-closed evidence')
  assert.equal(r.signal, null, 'a signal kill is not valid fail-closed evidence')
  assert.doesNotMatch(r.stdout + r.stderr,
    /fictional-shop|example\.invalid|synthetic tiny|supa-qa-id-preflight-/)
  return r
}

async function rejectsInvalidManifest(...dirs) {
  await assert.rejects(compareCaptureDirectories(...dirs), (err) =>
    err instanceof Error && err.message === 'Invalid or oversized M1 capture manifest')
  const r = cli(...dirs)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '', 'invalid cohort cannot emit partial reviewer JSON')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
}

async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-id-preflight-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}

function assertManualOnly(r, priority, status, count, baselineProvided) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const data = JSON.parse(r.stdout)
  assert.equal(data.actions.length, count)
  assert.equal(data.baselineProvided, baselineProvided)
  for (const action of data.actions) {
    assert.equal(action.priority, priority)
    assert.equal(action.status, status)
    assert.equal(action.productionEnabled, false)
    assert.equal(action.selectorVerified, false)
    assert.equal(action.rightsVerified, false)
  }
  assert.equal(data.productionReady, false)
  assert.equal(data.m5Eligible, false)
  assert.equal(data.selectorVerified, false)
  assert.equal(data.rightsVerified, false)
}

test('independent: two different canonical source IDs remain private P2 without historical baseline', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [row('fictional-one'), row('fictional-two')], { writeHtml: true })
    assertManualOnly(cli(now.dir), 'P2', 'baseline_missing', 2, false)
    await unchanged(now)
  })
})

test('independent: same IDs shared ACROSS two genuinely independent chronological captures remain P3 private-only', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [row('fictional-one'), row('fictional-two')], { writeHtml: true })
    const past = await fixture(root, 'older', [
      row('fictional-one', { at: '2026-10-12T10:00:00Z' }),
      row('fictional-two', { at: '2026-10-12T10:00:00Z' }),
    ], { writeHtml: true })
    assertManualOnly(cli(now.dir, past.dir), 'P3', 'unchanged', 2, true)
    await unchanged(now, past)
  })
})

test('independent: duplicate ID across available and unavailable rows refuses before missing current HTML', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [row('same-id'), row('same-id', { success: false })])
    await rejectsInvalidManifest(now.dir)
    await unchanged(now)
  })
})

test('independent: duplicate ID across two markets refuses before HTML lookup despite valid SHA metadata', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [
      row('same-id', { market: 'fictional-shop-a' }),
      row('same-id', { market: 'fictional-shop-b' }),
    ])
    await rejectsInvalidManifest(now.dir)
    await unchanged(now)
  })
})

test('independent: duplicate unavailable P1 IDs cannot produce deceptive healthy review queue', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [
      row('same-id', { success: false }), row('same-id', { success: false }),
    ])
    await rejectsInvalidManifest(now.dir)
    await unchanged(now)
  })
})

test('independent: duplicate historical ID refuses before reading intentionally missing current HTML', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [row('fictional-one')])
    const old = await fixture(root, 'older', [
      row('fictional-one', { at: '2026-10-12T10:00:00Z' }),
      row('fictional-one', { success: false }),
    ])
    await rejectsInvalidManifest(now.dir, old.dir)
    await unchanged(now, old)
  })
})

test('independent: invalid current raw source ID refuses before successful HTML file traversal', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [
      row('fictional-one'), row('../borrowed'),
    ])
    await rejectsInvalidManifest(now.dir)
    await unchanged(now)
  })
})

test('independent: invalid historical raw source ID refuses before current successful HTML read', async () => {
  await sandbox(async root => {
    const now = await fixture(root, 'current', [row('fictional-one')])
    const old = await fixture(root, 'older', [row('bad/name', { success: false })])
    await rejectsInvalidManifest(now.dir, old.dir)
    await unchanged(now, old)
  })
})
