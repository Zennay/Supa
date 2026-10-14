import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// All fixtures are invented local-only M1 capture directories. Never connect
// to a supermarket or include actual customer/product/price observations.
const CLI = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const ID = 'invented-source'
const STORE = 'fictional-shop'
const REDACT = /invented-source|fictional-shop|__supa-private|<html|<script|example\.invalid/
const HTML_ONE = '<html><head><title>Fictional</title><script type="application/ld+json">{"@type":"Product"}</script></head></html>'
const HTML_TWO = '<html><head><title>Fictional</title><script type="application/ld+json">{"@type":"Product","offers":{"price":"0"}}</script></head></html>'
const run = (...args) => spawnSync(process.execPath,
  ['--experimental-strip-types', CLI, ...args], { encoding: 'utf8', timeout: 15000 })
const sha256 = value => createHash('sha256').update(value).digest('hex')
const requireGenericFailure = result => {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Offline review failed: invalid capture or report\n')
  assert.doesNotMatch(result.stderr, REDACT)
}

async function makeCapture(parent, dir, capturedAt, html = HTML_ONE, overrideHash) {
  const root = path.join(parent, dir)
  await mkdir(path.join(root, STORE), { recursive: true })
  await writeFile(path.join(root, STORE, ID + '.html'), html)
  const manifest = {
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: ID, supermarket: STORE, kind: 'product', success: true,
      requestedUrl: 'https://example.invalid/__supa-private',
      capturedAt,
      sha256: overrideHash ?? sha256(html),
    }],
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  return root
}

test('summary-only CLI: one locally SHA-verified capture gives P2 aggregate without source tokens', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'supa-m5-summary-'))
  try {
    const dir = await makeCapture(root, 'now', '2026-10-14T00:00:00.000Z')
    const aggregate = run('--summary-only', dir)
    assert.equal(aggregate.status, 0, aggregate.stderr)
    assert.equal(aggregate.stderr, '')
    assert.doesNotMatch(aggregate.stdout, REDACT)
    const output = JSON.parse(aggregate.stdout)
    assert.equal(output.mode, 'offline_selector_review_summary_only')
    assert.equal(output.summary.actionCount, 1)
    assert.deepEqual(output.summary.priorityCounts, { P1: 0, P2: 1, P3: 0 })
    assert.equal(output.summary.statusCounts.baseline_missing, 1)
    assert.equal(output.baselineProvided, false)
    assert.equal(output.sourceCount, 1)
    assert.equal(output.driftCount, 0)
    assert.equal(Object.hasOwn(output, 'actions'), false)
    assert.equal(output.reviewerActionRequired, true)
    assert.equal(output.selectorVerified, false)
    assert.equal(output.rightsVerified, false)
    assert.equal(output.productionReady, false)
    assert.equal(output.m5Eligible, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('summary-only CLI: same fictitious historical HTML is P3, default still returns full private actions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'supa-m5-summary-'))
  try {
    const now = await makeCapture(root, 'current', '2026-10-14T12:00:00.000Z')
    const before = await makeCapture(root, 'past', '2026-10-13T12:00:00.000Z')
    const plain = run(now, before)
    const redacted = run('--summary-only', now, before)
    assert.equal(plain.status, 0, plain.stderr)
    assert.equal(redacted.status, 0, redacted.stderr)
    const full = JSON.parse(plain.stdout)
    const aggregate = JSON.parse(redacted.stdout)
    assert.equal(full.mode, 'offline_selector_review_queue_only')
    assert.equal(full.actions.length, 1)
    assert.match(full.actions[0].sourceToken, /^[a-f0-9]{64}$/)
    assert.equal(full.actions[0].priority, 'P3')
    assert.deepEqual(aggregate.summary, full.summary)
    assert.equal(aggregate.summary.statusCounts.unchanged, 1)
    assert.equal(aggregate.summary.priorityCounts.P3, 1)
    assert.equal(Object.hasOwn(aggregate, 'actions'), false)
    assert.doesNotMatch(redacted.stdout, REDACT)
    assert.doesNotMatch(redacted.stdout, new RegExp(full.actions[0].sourceToken))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('summary-only CLI: real fictional HTML structural change reports P1 and no source-level records', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'supa-m5-summary-'))
  try {
    const now = await makeCapture(root, 'now', '2026-10-14T12:00:00.000Z', HTML_TWO)
    const before = await makeCapture(root, 'before', '2026-10-13T12:00:00.000Z', HTML_ONE)
    const result = run('--summary-only', now, before)
    assert.equal(result.status, 0, result.stderr)
    const out = JSON.parse(result.stdout)
    assert.equal(out.summary.actionCount, 1)
    assert.equal(out.summary.priorityCounts.P1, 1)
    assert.equal(out.summary.statusCounts.shape_changed, 1)
    assert.equal(out.m5Eligible, false)
    assert.equal(Object.hasOwn(out, 'actions'), false)
    assert.doesNotMatch(result.stdout, REDACT)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('summary-only CLI: invalid SHA verification refuses any aggregate or partial stdout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'supa-m5-summary-'))
  try {
    const dir = await makeCapture(root, 'now', '2026-10-14T12:00:00.000Z',
      HTML_ONE, 'f'.repeat(64))
    requireGenericFailure(run('--summary-only', dir))
    requireGenericFailure(run(dir))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('summary-only CLI: nonexistent path and disallowed options redact errors', () => {
  for (const args of [
    [], ['--summary-only'], ['--summary-only', '--summary-only'],
    ['--nope', 'fictional'], ['fictional', '--summary-only'],
    ['--summary-only', 'fictional', '--wrong'],
    ['--summary-only', 'a', 'b', 'c'],
    ['--summary-only', path.join(tmpdir(), '__supa-private-no-such-dir')],
  ]) requireGenericFailure(run(...args))
})

test('summary-only CLI: zero-source verified synthetic M1 manifest has explicit zero P1/P2/P3 counts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'supa-m5-summary-'))
  try {
    const dir = path.join(root, 'empty')
    await mkdir(dir)
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      milestone: 'M1 Data Feasibility', bounded: true,
      sourceCount: 0, results: [],
    }))
    const result = run('--summary-only', dir)
    assert.equal(result.status, 0, result.stderr)
    const out = JSON.parse(result.stdout)
    assert.equal(out.summary.actionCount, 0)
    assert.deepEqual(out.summary.priorityCounts, { P1: 0, P2: 0, P3: 0 })
    assert.equal(Object.values(out.summary.statusCounts).reduce((a,b)=>a+b,0),0)
    assert.equal(out.sourceCount, 0)
    assert.deepEqual(Object.keys(out).includes('actions'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
