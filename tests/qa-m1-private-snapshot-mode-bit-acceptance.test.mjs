import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditCaptureFiles } from '../scripts/m1-research-snapshot-audit.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

// Postrepair synthetic acceptance on #1261 / #1258. No live retailer files.
const source = RESEARCH_SOURCES.find(item => item.id === 'dirk-halvarine')
const nowMs = Date.parse('2026-10-11T00:40:00.000Z')
const stem = 'capture-' + (nowMs - 60000) + '-300'
const secret = 'SECRET-PRIVATE-FIXTURE-NOT-A-PRICE'

async function privateFixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-permission-bits-'))
  const outputDir = join(root, 'captures')
  const sourceDir = join(outputDir, source.id)
  await mkdir(sourceDir, { recursive: true, mode: 0o700 })
  const body = Buffer.from('<html>' + secret + '</html>')
  const html = join(sourceDir, stem + '.html')
  const meta = join(sourceDir, stem + '.json')
  const metadata = {
    version: 1, type: 'research-only-not-price-proof', sourceId: source.id,
    store: source.store, url: source.url, observedAt: new Date(nowMs - 60000).toISOString(),
    httpStatus: 200, mediaType: 'text/html', bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'), proxyMode: 'direct',
  }
  await writeFile(html, body, { mode: 0o600 })
  await writeFile(meta, JSON.stringify(metadata), { mode: 0o600 })
  const audit = () => auditCaptureFiles({ outputDir, sourceId: source.id, stem, nowMs })
  const cleanup = async () => {
    await chmod(outputDir, 0o700)
    await chmod(sourceDir, 0o700)
    await rm(root, { recursive: true, force: true })
  }
  return { root, outputDir, sourceDir, html, meta, audit, cleanup }
}

test('owner-only restrictive 0500 dirs and 0400 files still permit privacy-safe manual review', async () => {
  const f = await privateFixture()
  try {
    await chmod(f.html, 0o400)
    await chmod(f.meta, 0o400)
    await chmod(f.sourceDir, 0o500)
    await chmod(f.outputDir, 0o500)
    const result = await f.audit()
    assert.equal(result.status, 'manual-review')
    assert.equal(result.semanticVerified, false)
    assert.equal(result.livePriceVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.doesNotMatch(JSON.stringify(result), /SECRET-PRIVATE|<html>/)
  } finally { await f.cleanup() }
})

test('non-readable but group/world-writable saved HTML or JSON is not considered private', async () => {
  for (const key of ['html', 'meta']) {
    for (const mode of [0o620, 0o601, 0o660]) {
      const f = await privateFixture()
      try {
        await chmod(f[key], mode)
        await assert.rejects(f.audit(), error =>
          error instanceof Error && /private|regular files/i.test(error.message) &&
          !error.message.includes(secret))
      } finally { await f.cleanup() }
    }
  }
})

test('group/world execute or write permission on either private capture dir is denied', async () => {
  for (const key of ['outputDir', 'sourceDir']) {
    for (const mode of [0o701, 0o710, 0o720]) {
      const f = await privateFixture()
      try {
        await chmod(f[key], mode)
        await assert.rejects(f.audit(), error =>
          error instanceof Error && /private directories/i.test(error.message) &&
          !error.message.includes(secret))
      } finally { await f.cleanup() }
    }
  }
})
