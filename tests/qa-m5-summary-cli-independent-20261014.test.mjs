import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent local-only synthetic M1 manifests. No retailer access,
// actual prices, customer data, real user URLs or remote network traffic.
const CLI = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const SHOP = 'synthetic-review-source'
const HTML_A = '<html><head><title>Fictitious alpha</title></head></html>'
const HTML_B = '<html><head><title>Fictitious beta</title></head></html>'
const HTML_C = '<html><head><title>Fictitious gamma</title><script type="application/ld+json">{"@type":"Product"}</script></head></html>'
const H = x => createHash('sha256').update(x).digest('hex')
const run = (...args) => spawnSync(process.execPath,
  ['--experimental-strip-types', CLI, ...args], { encoding: 'utf8', timeout: 15000 })
const withTemp = async callback => {
  const dir = await mkdtemp(path.join(tmpdir(), 'supa-independent-m5-'))
  try { return await callback(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}
async function capture(parent, folder, date, items, corruptHashId = null) {
  const root = path.join(parent, folder)
  await mkdir(path.join(root, SHOP), { recursive: true })
  const results = []
  for (const [id, html] of items) {
    await writeFile(path.join(root, SHOP, id + '.html'), html)
    results.push({
      id, supermarket: SHOP, kind: 'product', success: true,
      requestedUrl: 'https://example.invalid/__PRIVATE__' + id,
      capturedAt: date, sha256: id === corruptHashId ? 'f'.repeat(64) : H(html),
    })
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: items.length, results,
  }))
  return root
}
const parse = result => {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  return JSON.parse(result.stdout)
}
function genericFailure(result, privatePath = null) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Offline review failed: invalid capture or report\n')
  if (privatePath) assert.doesNotMatch(result.stderr, new RegExp(privatePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}
const privacy = (value, privateIds) => {
  const text = JSON.stringify(value)
  for (const id of privateIds) assert.ok(!text.includes(id), 'raw source leaked: ' + id)
  assert.doesNotMatch(text, /sourceToken|https?:|example\.invalid|__PRIVATE__|<html|Fictitious|pricePerPack|productName/)
  assert.equal(value.productionReady, false)
  assert.equal(value.m5Eligible, false)
  assert.equal(value.rightsVerified, false)
  assert.equal(value.selectorVerified, false)
  assert.equal(Object.hasOwn(value, 'actions'), false)
}

test('independent summary CLI: two current synthetic sources report P2 count 2 with zero per-source tokens', async () => {
  await withTemp(async parent => {
    const current = await capture(parent, 'now', '2026-10-14T15:00:00.000Z',
      [['qa-secret-one', HTML_A], ['qa-secret-two', HTML_B]])
    const out = parse(run('--summary-only', current))
    privacy(out, ['qa-secret-one', 'qa-secret-two', SHOP, current])
    assert.equal(out.mode, 'offline_selector_review_summary_only')
    assert.equal(out.summary.actionCount, 2)
    assert.deepEqual(out.summary.priorityCounts, { P1: 0, P2: 2, P3: 0 })
    assert.equal(out.summary.statusCounts.baseline_missing, 2)
    assert.equal(out.sourceCount, 2)
    assert.equal(out.driftCount, 0)
  })
})
test('independent summary CLI: two matching old captures remain anonymous P3 x2', async () => {
  await withTemp(async parent => {
    const items = [['qa-private-a', HTML_A], ['qa-private-b', HTML_B]]
    const now = await capture(parent, 'current', '2026-10-14T15:00:00.000Z', items)
    const old = await capture(parent, 'historical', '2026-10-13T15:00:00.000Z', items)
    const plain = parse(run(now, old))
    const redacted = parse(run('--summary-only', now, old))
    assert.equal(plain.actions.length, 2)
    assert.equal(plain.mode, 'offline_selector_review_queue_only')
    assert.ok(plain.actions.every(x => /^[0-9a-f]{64}$/.test(x.sourceToken)))
    assert.equal(redacted.summary.priorityCounts.P3, 2)
    assert.deepEqual(redacted.summary, plain.summary)
    privacy(redacted, ['qa-private-a', 'qa-private-b', SHOP, now, old, ...plain.actions.map(x => x.sourceToken)])
  })
})
test('independent summary CLI: disappeared historical source counts P1 removed while present source remains P3', async () => {
  await withTemp(async parent => {
    const present = [['kept-private', HTML_A]]
    const now = await capture(parent, 'now', '2026-10-14T15:00:00.000Z', present)
    const old = await capture(parent, 'old', '2026-10-13T15:00:00.000Z',
      [...present, ['removed-private', HTML_B]])
    const out = parse(run('--summary-only', now, old))
    assert.equal(out.summary.actionCount, 2)
    assert.equal(out.summary.priorityCounts.P1, 1)
    assert.equal(out.summary.priorityCounts.P3, 1)
    assert.equal(out.summary.statusCounts.removed, 1)
    assert.equal(out.summary.statusCounts.unchanged, 1)
    privacy(out, ['kept-private', 'removed-private', SHOP, now, old])
  })
})
test('independent summary CLI: real changed synthetic HTML yields P1 without token', async () => {
  await withTemp(async parent => {
    const now = await capture(parent, 'now', '2026-10-14T15:00:00.000Z', [['changed-private', HTML_C]])
    const old = await capture(parent, 'old', '2026-10-13T15:00:00.000Z', [['changed-private', HTML_A]])
    const out = parse(run('--summary-only', now, old))
    assert.equal(out.summary.actionCount, 1)
    assert.equal(out.summary.priorityCounts.P1, 1)
    assert.equal(out.summary.statusCounts.shape_changed, 1)
    privacy(out, ['changed-private', SHOP, now, old])
  })
})
test('independent summary CLI: corrupt SHA on second synthetic source never emits partial aggregate', async () => {
  await withTemp(async parent => {
    const current = await capture(parent, 'now', '2026-10-14T15:00:00.000Z',
      [['valid-private', HTML_A], ['invalid-private', HTML_B]], 'invalid-private')
    genericFailure(run('--summary-only', current), current)
  })
})
test('independent summary CLI: malformed flags, trailing and duplicate options always produce generic failure', () => {
  for (const options of [
    [], ['--summary-only'], ['--summary-only', '--summary-only'],
    ['--unknown', '/tmp/not-existing-private'], ['/tmp/private', '--summary-only'],
    ['--summary-only', '/tmp/private', '--extra'], ['--summary-only', 'a', 'b', 'c'],
    ['--summary-only', 'a', '--summary-only', 'b'],
  ]) genericFailure(run(...options))
})
test('independent summary CLI: empty fictional M1 manifest returns eleven zero categories', async () => {
  await withTemp(async parent => {
    const empty = await capture(parent, 'empty', '2026-10-14T15:00:00.000Z', [])
    const out = parse(run('--summary-only', empty))
    assert.equal(out.summary.actionCount, 0)
    assert.deepEqual(out.summary.priorityCounts, { P1: 0, P2: 0, P3: 0 })
    assert.equal(Object.keys(out.summary.statusCounts).length, 8)
    assert.ok(Object.values(out.summary.statusCounts).every(x => x === 0))
    privacy(out, [empty, SHOP])
  })
})
test('independent summary CLI: default invocation still provides old per-source queue unchanged', async () => {
  await withTemp(async parent => {
    const now = await capture(parent, 'now', '2026-10-14T15:00:00.000Z',
      [['token-only-private', HTML_A]])
    const full = parse(run(now)), short = parse(run('--summary-only', now))
    assert.equal(full.mode, 'offline_selector_review_queue_only')
    assert.equal(full.actions.length, 1)
    assert.equal(full.actions[0].priority, 'P2')
    assert.equal(short.mode, 'offline_selector_review_summary_only')
    assert.deepEqual(short.summary, full.summary)
    assert.equal(Object.hasOwn(short, 'actions'), false)
    assert.doesNotMatch(short.stdout || '', /token-only-private/)
  })
})
test('independent summary CLI: verified local input files remain unmodified by comparison', async () => {
  await withTemp(async parent => {
    const items = [['must-not-overwrite', HTML_A]]
    const current = await capture(parent, 'now', '2026-10-14T15:00:00.000Z', items)
    const existing = await capture(parent, 'old', '2026-10-13T15:00:00.000Z', items)
    const { readFile } = await import('node:fs/promises')
    const before = await Promise.all([current, existing].map(x => readFile(path.join(x, 'manifest.json'))))
    parse(run('--summary-only', current, existing))
    const after = await Promise.all([current, existing].map(x => readFile(path.join(x, 'manifest.json'))))
    assert.deepEqual(after, before)
  })
})
