import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'
import { auditResearchSnapshot, auditCaptureFiles } from '../scripts/m1-research-snapshot-audit.mjs'

const source = RESEARCH_SOURCES.find(entry => entry.id === 'dirk-halvarine')
const html = Buffer.from('<html>synthetic fixture: no retailer or price evidence</html>')
const digest = createHash('sha256').update(html).digest('hex')
const nowMs = Date.parse('2026-10-10T23:40:00.000Z')
const timestamp = new Date(nowMs - 60_000).toISOString()

function metadata(overrides = {}) {
  return { version: 1, type: 'research-only-not-price-proof',
    sourceId: source.id, store: source.store, url: source.url, observedAt: timestamp,
    httpStatus: 200, mediaType: 'text/html', bytes: html.length,
    sha256: digest, proxyMode: 'direct', ...overrides }
}

function verify(meta = metadata(), body = html, options = {}) {
  return auditResearchSnapshot({ sourceId: source.id, metadata: meta, body,
    nowMs, ...options })
}

test('synthetic unmodified snapshot is only ready for manual DOM review, never a price or M3 proof', () => {
  const report = verify()
  assert.equal(report.status, 'manual-review')
  assert.equal(report.sourceId, source.id)
  assert.equal(report.semanticVerified, false)
  assert.equal(report.livePriceVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.deepEqual(report.reasons, [])
  assert.equal(report.ageHours, 1 / 60)
  assert.doesNotMatch(JSON.stringify(report), /synthetic fixture|private price payload|€/)
})

test('capture provenance rejects mutated HTML and forged digest, byte count or URL', () => {
  for (const bad of [
    verify(metadata(), Buffer.from('<html>tampered</html>')),
    verify(metadata({ sha256: '0'.repeat(64) })),
    verify(metadata({ bytes: html.length + 1 })),
    verify(metadata({ url: 'https://www.dirk.nl/other-product' })),
  ]) {
    assert.equal(bad.status, 'rejected')
    assert.equal(bad.publicSavingsClaimEligible, false)
    assert.ok(bad.reasons.length)
  }
})

test('collector status, non-proof type, source identity and egress provenance must match', () => {
  for (const overrides of [
    { sourceId: 'ah-halfvolle-melk' }, { store: 'jumbo' }, { type: 'verified-prices' },
    { version: 3 }, { httpStatus: 403 }, { mediaType: 'text/plain' },
    { proxyMode: 'rotating-proxy' },
  ]) assert.equal(verify(metadata(overrides)).status, 'rejected')
  assert.equal(verify(metadata({ proxyMode: 'approved-fixed-egress',
    mediaType: 'application/xhtml+xml' })).status, 'manual-review')
  assert.equal(auditResearchSnapshot({ sourceId: '../other', metadata: metadata(),
    body: html, nowMs }).status, 'rejected')
})

test('strict capture age rejects future, stale, malformed and noncanonical timestamps', () => {
  for (const observedAt of [
    new Date(nowMs + 1).toISOString(),
    new Date(nowMs - 24 * 3600_000 - 1).toISOString(),
    '2026-02-30T20:00:00.000Z', '2026-10-10T23:39:00+00:00',
    '2026-10-10', 'not-a-time',
  ]) assert.equal(verify(metadata({ observedAt })).status, 'rejected')
  assert.equal(verify(metadata({ observedAt: new Date(nowMs - 24 * 3600_000).toISOString() })).status,
    'manual-review')
})

test('malformed data containers fail closed and results never echo attacker-controlled values', () => {
  for (const bad of [null, [], 'leak-private-value', 3, { ...metadata(), sha256: null }]) {
    const report = verify(bad)
    assert.equal(report.status, 'rejected')
    assert.doesNotMatch(JSON.stringify(report), /leak-private-value/)
  }
  for (const bad of [null, 'body', Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
    assert.equal(verify(metadata(), bad).status, 'rejected')
  }
})

test('private fixture pair on disk can be audited without exposing HTML', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-snapshot-audit-'))
  try {
    const sourceDir = join(dir, source.id)
    const stem = 'capture-1791675600000-1234'
    await mkdir(sourceDir, { mode: 0o700 })
    await writeFile(join(sourceDir, stem + '.html'), html, { mode: 0o600 })
    await writeFile(join(sourceDir, stem + '.json'), JSON.stringify(metadata()), { mode: 0o600 })
    const ok = await auditCaptureFiles({ sourceId: source.id, stem, outputDir: dir, nowMs })
    assert.equal(ok.status, 'manual-review')
    assert.doesNotMatch(JSON.stringify(ok), /synthetic fixture|boodschappen/)
    await writeFile(join(sourceDir, stem + '.html'), '<html>tampered</html>')
    assert.equal((await auditCaptureFiles({ sourceId: source.id, stem, outputDir: dir, nowMs })).status,
      'rejected')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('capture audit refuses traversal and private symlinked snapshots before reading', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-snapshot-symlink-'))
  try {
    const sourceDir = join(dir, source.id)
    const stem = 'capture-1791675600000-4321'
    await mkdir(sourceDir, { mode: 0o700 })
    const target = join(dir, 'elsewhere.txt')
    await writeFile(target, 'private-dont-read')
    await symlink(target, join(sourceDir, stem + '.html'))
    await writeFile(join(sourceDir, stem + '.json'), JSON.stringify(metadata()), { mode: 0o600 })
    await assert.rejects(auditCaptureFiles({ sourceId: source.id, stem, outputDir: dir, nowMs }),
      /regular files/)
    await assert.rejects(auditCaptureFiles({ sourceId: source.id, stem: '../escape',
      outputDir: dir, nowMs }), /invalid capture stem/)
    await assert.rejects(auditCaptureFiles({ sourceId: '../escape', stem,
      outputDir: dir, nowMs }), /unknown source/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
