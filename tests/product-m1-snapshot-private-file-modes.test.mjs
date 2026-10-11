import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditCaptureFiles } from '../scripts/m1-research-snapshot-audit.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const source = RESEARCH_SOURCES.find(item => item.id === 'dirk-halvarine')
const nowMs = Date.parse('2026-10-11T00:00:00.000Z')
const secret = 'PRIVATE-SYNTHETIC-CAPTURE-DO-NOT-EXPOSE'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-private-audit-modes-'))
  const outputDir = join(root, 'captures')
  const sourceDir = join(outputDir, source.id)
  await mkdir(sourceDir, { recursive: true, mode: 0o700 })
  const stem = 'capture-' + (nowMs - 60000) + '-1234'
  const body = Buffer.from('<html>' + secret + '</html>', 'utf8')
  const metadata = {
    version: 1, type: 'research-only-not-price-proof', sourceId: source.id,
    store: source.store, url: source.url,
    observedAt: new Date(nowMs - 60000).toISOString(),
    httpStatus: 200, mediaType: 'text/html', bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    proxyMode: 'direct',
  }
  const html = join(sourceDir, stem + '.html')
  const json = join(sourceDir, stem + '.json')
  await writeFile(html, body, { mode: 0o600 })
  await writeFile(json, JSON.stringify(metadata), { mode: 0o600 })
  const audit = () => auditCaptureFiles({ sourceId: source.id, stem, outputDir, nowMs })
  return { root, outputDir, sourceDir, html, json, audit }
}

test('canonical 0700 folders and 0600 fixture files retain private manual review only', async () => {
  const f = await fixture()
  try {
    const result = await f.audit()
    assert.equal(result.status, 'manual-review')
    assert.equal(result.livePriceVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.semanticVerified, false)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SYNTHETIC|<html>/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('saved HTML and metadata changing to group/world-readable must fail closed', async () => {
  for (const key of ['html', 'json']) {
    const f = await fixture()
    try {
      await chmod(f[key], 0o644)
      await assert.rejects(f.audit(), error =>
        error instanceof Error && /private|permission/i.test(error.message) &&
        !error.message.includes(secret))
    } finally { await rm(f.root, { recursive: true, force: true }) }
  }
})

test('previously private capture root or source directory becoming shared must fail closed', async () => {
  for (const key of ['outputDir', 'sourceDir']) {
    const f = await fixture()
    try {
      await chmod(f[key], 0o755)
      await assert.rejects(f.audit(), error =>
        error instanceof Error && /private|permission/i.test(error.message) &&
        !error.message.includes(secret))
    } finally { await rm(f.root, { recursive: true, force: true }) }
  }
})
