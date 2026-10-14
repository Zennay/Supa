import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  compareCaptureDirectories, readBoundedManifest,
} from '../scripts/m5-compare-capture-signatures.mjs'

// Independent QA on invented offline manifests, no real sources/HTTP/data.
const HTML = '<!doctype html><html><body>fictional HTML only</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const CLI = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const MARK = 'QA_TOKEN_73'
function row(id = 'valid-source', extra = {}) {
  return { id, supermarket: 'pretend-store', kind: 'product', success: true,
    requestedUrl: 'https://example.invalid/a', capturedAt: '2026-10-14T00:00:00.000Z',
    sha256: SHA, ...extra }
}
const failed = (id = 'failed-source', extra = {}) => ({
  id, supermarket: 'pretend-store', kind: 'product', success: false,
  requestedUrl: 'https://example.invalid/unavailable', ...extra,
})
async function isolated(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-fatal-utf8-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
async function capture(root, name, rows, options = {}) {
  const dir = join(root, name)
  await mkdir(dir)
  if (options.html === true) {
    await mkdir(join(dir, 'pretend-store'))
    for (const r of rows) if (r.success) {
      await writeFile(join(dir, 'pretend-store', r.id + '.html'), HTML)
    }
  }
  let bytes = Buffer.from(JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  }), 'utf8')
  if (options.corrupt) {
    const target = Buffer.from(MARK)
    const at = bytes.indexOf(target)
    assert.ok(at >= 0, 'explicit marker must exist')
    bytes = Buffer.concat([
      bytes.subarray(0, at), options.corrupt, bytes.subarray(at + target.length),
    ])
  }
  if (options.bom) bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, bytes)
  return { dir, manifest, bytes }
}
function cli(now, before) {
  const r = spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, now.dir, ...(before ? [before.dir] : [])],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /pretend-store|example\.invalid|supa-qa-fatal-utf8-|fictional HTML only/)
  return r
}
async function rejectsEarly(now, before = null) {
  // Earlier successful source HTML is deliberately absent. Exact manifest
  // error proves strict byte decoding precedes all successful HTML I/O.
  await assert.rejects(compareCaptureDirectories(now.dir, before?.dir), err =>
    err instanceof Error && err.message === 'Invalid or oversized M1 capture manifest')
  const r = cli(now, before)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
  assert.deepEqual(await readFile(now.manifest), now.bytes)
  if (before) assert.deepEqual(await readFile(before.manifest), before.bytes)
}
function manual(r, priority, status) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const value = JSON.parse(r.stdout)
  assert.equal(value.actions.length, 1)
  assert.equal(value.actions[0].priority, priority)
  assert.equal(value.actions[0].status, status)
  for (const field of ['productionReady', 'rightsVerified', 'selectorVerified', 'm5Eligible']) {
    assert.equal(value[field], false)
  }
  assert.equal(value.actions[0].productionEnabled, false)
}
for (const [name, bytes] of [
  ['lone continuation', Buffer.from([0x80])],
  ['incomplete 4-byte sequence', Buffer.from([0xf0, 0x9f, 0xa5])],
  ['utf8 surrogate encoding', Buffer.from([0xed, 0xa0, 0x80])],
  ['overlong NUL', Buffer.from([0xc0, 0x80])],
  ['codepoint above U+10ffff', Buffer.from([0xf4, 0x90, 0x80, 0x80])],
  ['stray leading ff', Buffer.from([0xff])],
]) {
  test('independent fatal UTF8: later current P1 metadata ' + name + ' rejected before HTML', async () => {
    await isolated(async root => {
      const now = await capture(root, 'now', [
        row(), failed('later-failed', { qaMetadata: MARK }),
      ], { corrupt: bytes })
      await rejectsEarly(now)
    })
  })
}
test('independent fatal UTF8: bad historical P1 metadata refuses before current HTML', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    const old = await capture(root, 'old', [
      row('valid-source', { capturedAt: '2026-10-13T00:00:00.000Z' }),
      failed('late-failed', { qaMetadata: MARK }),
    ], { corrupt: Buffer.from([0xed, 0xb0, 0x80]) })
    await rejectsEarly(now, old)
  })
})
test('independent fatal UTF8: late current success with invalid unused metadata fails before HTML', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [
      row(), row('later-success', { qaMetadata: MARK }),
    ], { corrupt: Buffer.from([0xc3, 0x28]) })
    await rejectsEarly(now)
  })
})
test('independent fatal UTF8: historical successful metadata corruption preempts current HTML', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    const old = await capture(root, 'old', [
      row('valid-source', { qaMetadata: MARK,
        capturedAt: '2026-10-13T00:00:00.000Z' }),
    ], { corrupt: Buffer.from([0xfe]) })
    await rejectsEarly(now, old)
  })
})
test('independent fatal UTF8: actual BOM remains a rejected raw manifest', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()], { bom: true })
    await rejectsEarly(now)
  })
})
test('independent fatal UTF8: literal valid replacement glyph in P1 is not invalid bytes', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [
      failed('failed-source', { qaMetadata: 'literal-\uFFFD-valid' }),
    ])
    manual(cli(now), 'P1', 'unavailable')
  })
})
test('independent fatal UTF8: valid four-byte Unicode in current and independent older P3', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [
      row('same-id', { qaMetadata: 'valid 🍲' }),
    ], { html: true })
    const old = await capture(root, 'old', [
      row('same-id', { qaMetadata: 'valid 🍲',
        capturedAt: '2026-10-13T00:00:00.000Z' }),
    ], { html: true })
    manual(cli(now, old), 'P3', 'unchanged')
  })
})
test('independent fatal UTF8: valid P2 Unicode with no baseline stays manual only', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [
      row('valid', { qaMetadata: '🤝' }),
    ], { html: true })
    manual(cli(now), 'P2', 'baseline_missing')
  })
})
test('independent fatal UTF8: descriptor Unicode split one byte per read round-trips', async () => {
  const payload = '{"notes":"🤝 café"}'
  const bytes = Buffer.from(payload, 'utf8')
  let index = 0
  const handle = { async read(target, offset) {
    if (index === bytes.length) return { bytesRead: 0 }
    target[offset] = bytes[index]
    index += 1
    return { bytesRead: 1 }
  } }
  assert.equal(await readBoundedManifest(handle), payload)
  assert.equal(index, bytes.length)
})
test('independent fatal UTF8: descriptor malformed low-level surrogate bytes throw', async () => {
  const bytes = Buffer.concat([
    Buffer.from('{"notes":"'),
    Buffer.from([0xed, 0xb0, 0x80]),
    Buffer.from('"}'),
  ])
  let index = 0
  const handle = { async read(target, offset, length) {
    const size = Math.min(length, 1, bytes.length - index)
    bytes.copy(target, offset, index, index + size)
    index += size
    return { bytesRead: size }
  } }
  await assert.rejects(readBoundedManifest(handle), TypeError)
  assert.equal(index, bytes.length)
})
