import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareCaptureDirectories, readBoundedManifest } from '../scripts/m5-compare-capture-signatures.mjs'

// QA-only synthetic stream and raw-source-origin boundary. Does not change
// product/adapter, call a retailer or claim atomic filesystem snapshot safety.
const LIMIT = 8 * 1024 * 1024
const CHUNK = 64 * 1024
const HTML = '<!doctype html><html><body>invented local M1</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const CLI = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname

function virtualHandle({ bytes = 0, chunkLimit = CHUNK, content = null }) {
  let position = 0
  const calls = []
  const payload = content ? Buffer.from(content, 'utf8') : null
  const available = payload?.length ?? bytes
  return {
    calls,
    get consumed() { return position },
    async read(buffer, offset, length, explicitPosition) {
      assert.equal(explicitPosition, null)
      assert.ok(length > 0 && length <= CHUNK, 'must never request over 64KiB')
      const amount = Math.min(length, chunkLimit, available - position)
      calls.push({ requested: length, bytesRead: amount })
      if (amount > 0) {
        if (payload) payload.copy(buffer, offset, position, position + amount)
        else buffer.fill(0x61, offset, offset + amount)
      }
      position += amount
      return { bytesRead: amount, buffer }
    },
  }
}
async function rootCase(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-m5-bounded-origin-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
function row(id, { success = true, market = 'fictional-store', kind = 'product', at = '2026-10-13T10:00:00.000Z' } = {}) {
  return {
    id, supermarket: market, kind, success,
    requestedUrl: 'https://example.invalid/synthetic-only',
    ...(success ? { capturedAt: at, sha256: SHA } : {}),
  }
}
async function capture(root, label, rows, writeHtml = false) {
  const dir = join(root, label)
  await mkdir(dir)
  const body = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  })
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, body)
  if (writeHtml) {
    for (const entry of rows) {
      if (!entry.success) continue
      const market = join(dir, entry.supermarket)
      await mkdir(market, { recursive: true })
      await writeFile(join(market, entry.id + '.html'), HTML)
    }
  }
  return { dir, manifest, body }
}
function call(...dirs) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', CLI, ...dirs], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
  })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /fictional-store|example\.invalid|invented local|supa-qa-m5-bounded-origin-/)
  return r
}
function manual(r, priority, status) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const data = JSON.parse(r.stdout)
  assert.equal(data.actions.length, 1)
  assert.equal(data.actions[0].priority, priority)
  assert.equal(data.actions[0].status, status)
  assert.equal(data.productionReady, false)
  assert.equal(data.rightsVerified, false)
  assert.equal(data.selectorVerified, false)
  assert.equal(data.m5Eligible, false)
  assert.equal(data.actions[0].productionEnabled, false)
}
async function rejectManifest(...dirs) {
  await assert.rejects(compareCaptureDirectories(...dirs), (err) =>
    err instanceof Error && err.message === 'Invalid or oversized M1 capture manifest')
  const r = call(...dirs)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
}

test('independent: descriptor stream round-trips UTF8 split across small read chunks', async () => {
  const payload = 'aé🍲Z'
  const h = virtualHandle({ content: payload, chunkLimit: 2 })
  assert.equal(await readBoundedManifest(h), payload)
  assert.equal(h.consumed, Buffer.byteLength(payload))
  assert.ok(h.calls.every(x => x.requested <= CHUNK))
})

test('independent: exactly 8MiB simulated descriptor is accepted without >64KiB read requests', async () => {
  const h = virtualHandle({ bytes: LIMIT })
  const text = await readBoundedManifest(h)
  assert.equal(Buffer.byteLength(text, 'utf8'), LIMIT)
  assert.equal(h.consumed, LIMIT)
  assert.ok(h.calls.length <= 129)
  assert.ok(h.calls.every(x => x.requested <= CHUNK))
})

test('independent: descriptor that grows from small advertised size to 64MiB is stopped after at most 8MiB+1 bytes', async () => {
  // A fake descriptor can reveal much more data than its earlier stat size.
  // This exercises read-time bounds, rather than an after-the-fact readFile().
  const advertisedStatBytes = 128
  const h = virtualHandle({ bytes: 64 * 1024 * 1024 })
  assert.ok(advertisedStatBytes < LIMIT)
  await assert.rejects(readBoundedManifest(h), /Invalid or oversized M1 capture manifest/)
  assert.equal(h.consumed, LIMIT + 1)
  assert.ok(h.calls.length <= 129)
  assert.ok(h.calls.every(x => x.requested <= CHUNK))
})

test('independent: empty descriptor reads zero bytes and returns an empty string', async () => {
  const h = virtualHandle({ bytes: 0 })
  assert.equal(await readBoundedManifest(h), '')
  assert.equal(h.consumed, 0)
  assert.equal(h.calls.length, 1)
})

test('independent: valid short source origin preserves SHA-verified current-only private P2', async () => {
  await rootCase(async root => {
    const now = await capture(root, 'now', [row('fictional-one')], true)
    manual(call(now.dir), 'P2', 'baseline_missing')
    assert.equal(await readFile(now.manifest, 'utf8'), now.body)
  })
})

test('independent: valid failed M1 source with canonical origin remains private P1 without HTML', async () => {
  await rootCase(async root => {
    const now = await capture(root, 'now', [row('fictional-one', { success: false })])
    manual(call(now.dir), 'P1', 'unavailable')
    assert.equal(await readFile(now.manifest, 'utf8'), now.body)
  })
})

test('independent: late invalid supermarket on successful source fails raw manifest BEFORE earlier missing HTML', async () => {
  await rootCase(async root => {
    const now = await capture(root, 'now', [
      row('fictional-one'), row('fictional-two', { market: 'bad/store' }),
    ])
    await rejectManifest(now.dir)
    assert.equal(await readFile(now.manifest, 'utf8'), now.body)
  })
})

test('independent: malformed kind on later failed/P1 row cannot slip through origin preflight', async () => {
  await rootCase(async root => {
    const now = await capture(root, 'now', [
      row('fictional-one'), row('fictional-two', { success: false, kind: ['product'] }),
    ])
    await rejectManifest(now.dir)
    assert.equal(await readFile(now.manifest, 'utf8'), now.body)
  })
})

test('independent: oversized historical kind refuses before intentionally missing valid current HTML', async () => {
  await rootCase(async root => {
    const now = await capture(root, 'now', [row('fictional-one')])
    const before = await capture(root, 'older', [
      row('fictional-one', { kind: 'k'.repeat(129), at: '2026-10-12T10:00:00Z' }),
    ])
    await rejectManifest(now.dir, before.dir)
    assert.equal(await readFile(now.manifest, 'utf8'), now.body)
    assert.equal(await readFile(before.manifest, 'utf8'), before.body)
  })
})
