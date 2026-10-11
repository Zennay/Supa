import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditCaptureFiles } from '../scripts/m1-research-snapshot-audit.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const source = RESEARCH_SOURCES.find(s => s.id === 'dirk-halvarine')
const nowMs = Date.parse('2026-10-11T00:29:00.000Z')
const observedAt = new Date(nowMs - 60_000).toISOString()
const stem = 'capture-' + (nowMs - 60_000) + '-37'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-capture-alias-'))
  const actual = join(root, 'private-canonical')
  const outputDir = join(actual, 'captures')
  const sourceDir = join(outputDir, source.id)
  await mkdir(sourceDir, { recursive: true, mode: 0o700 })
  const body = Buffer.from('<html><body>synthetic HTML for audit-only, no prices</body></html>')
  await writeFile(join(sourceDir, stem + '.html'), body, { mode: 0o600 })
  await writeFile(join(sourceDir, stem + '.json'), JSON.stringify({
    version: 1, type: 'research-only-not-price-proof',
    sourceId: source.id, store: source.store, url: source.url,
    observedAt, httpStatus: 200, mediaType: 'text/html',
    bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'),
    proxyMode: 'direct',
  }), { mode: 0o600 })
  return { root, actual, outputDir }
}

function audit(outputDir) {
  return auditCaptureFiles({ sourceId: source.id, stem, outputDir, nowMs })
}

test('canonical private on-disk SHA256 snapshot still permits manual review, never savings proof', async () => {
  const f = await fixture()
  try {
    const result = await audit(f.outputDir)
    assert.equal(result.status, 'manual-review')
    assert.equal(result.sourceId, source.id)
    assert.equal(result.semanticVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('an ancestor symlink may not redirect accepted private captures', async () => {
  const f = await fixture()
  try {
    const alias = join(f.root, 'alias')
    await symlink(f.actual, alias)
    await assert.rejects(audit(join(alias, 'captures')), /director|reject|alias|symlink|capture/i)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('a deeply nested symlink must be rejected before private HTML or metadata is read', async () => {
  const f = await fixture()
  try {
    const real = join(f.root, 'real')
    await mkdir(real, { mode: 0o700 })
    await symlink(f.actual, join(real, 'alias'))
    await assert.rejects(audit(join(real, 'alias', 'captures')), /director|reject|alias|symlink|capture/i)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('symlink at final capture root remains rejected', async () => {
  const f = await fixture()
  try {
    const alias = join(f.root, 'final-alias')
    await symlink(f.outputDir, alias)
    await assert.rejects(audit(alias), /director|reject|alias|symlink|capture/i)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
