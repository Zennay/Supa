import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveDomCandidateReview } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

// #1278: fake local research fixture only. Never opens a retailer URL.
const SOURCE = RESEARCH_SOURCES.find(x => x.id === 'dirk-halvarine')
const NOW = Date.parse('2026-10-11T00:30:00.000Z')
const WHEN = new Date(NOW - 60_000).toISOString()
const STEM = 'capture-' + (NOW - 60_000) + '-4242'
const PRIVATE = 'SYNTHETIC-PRIVATE-PROBE-NEVER-PRINTED'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-probe-ancestor-'))
  const captureDir = join(root, 'captures')
  const sourceDir = join(captureDir, SOURCE.id)
  const realRoot = join(root, 'real')
  const realDir = join(realRoot, 'nested')
  const probeFile = join(realDir, 'probe.json')
  await mkdir(sourceDir, { recursive: true, mode: 0o700 })
  await mkdir(realDir, { recursive: true, mode: 0o700 })
  const body = Buffer.from('<html>local fixture, not a price</html>')
  const metadata = {
    version: 1, type: 'research-only-not-price-proof',
    sourceId: SOURCE.id, store: SOURCE.store, url: SOURCE.url,
    observedAt: WHEN, httpStatus: 200, mediaType: 'text/html',
    bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'),
    proxyMode: 'direct',
  }
  await writeFile(join(sourceDir, STEM + '.html'), body, { mode: 0o600 })
  await writeFile(join(sourceDir, STEM + '.json'), JSON.stringify(metadata), { mode: 0o600 })
  const probe = {
    version: 1, kind: 'rendered-dom-candidate-only',
    originHost: new URL(SOURCE.url).hostname, capturedAt: WHEN,
    selectors: [{ role: 'product-name', selector: 'h1', count: 1,
      groundedInCurrentDom: true, semanticVerified: false }],
    actualClassCandidates: [],
    note: PRIVATE,
  }
  await writeFile(probeFile, JSON.stringify(probe), { mode: 0o600 })
  const review = (probePath, outputDir) => saveDomCandidateReview({
    sourceId: SOURCE.id, stem: STEM, probePath, captureDir, outputDir, nowMs: NOW,
  })
  return { root, realRoot, realDir, probeFile, review }
}

test('canonical nested private DOM probe is review-only, never savings evidence', async () => {
  const f = await fixture()
  try {
    const outputDir = join(f.root, 'good-reviews')
    const result = await f.review(f.probeFile, outputDir)
    assert.equal(result.status, 'human-semantic-review-required')
    assert.equal(result.structuralCandidates, 1)
    assert.equal(result.classCandidates, 0)
    assert.equal(result.semanticVerified, false)
    assert.equal(result.livePriceVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    const onDisk = await readFile(join(outputDir, SOURCE.id, STEM + '-candidate-review.json'), 'utf8')
    assert.doesNotMatch(onDisk, /SYNTHETIC-PRIVATE-PROBE/)
    assert.equal(JSON.parse(onDisk).domCaptureIdentityVerified, false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

for (const variant of ['immediate-parent', 'higher-ancestor']) {
  test('symlinked ' + variant + ' of otherwise valid private probe fails before output', async () => {
    const f = await fixture()
    try {
      let aliasPath
      if (variant === 'immediate-parent') {
        const alias = join(f.root, 'alias-dir')
        await symlink(f.realDir, alias)
        aliasPath = join(alias, 'probe.json')
      } else {
        const alias = join(f.root, 'alias-outer')
        await symlink(f.realRoot, alias)
        aliasPath = join(alias, 'nested', 'probe.json')
      }
      const outputDir = join(f.root, variant + '-reject')
      await assert.rejects(f.review(aliasPath, outputDir), err =>
        err instanceof Error && /private DOM candidate report rejected/.test(err.message) &&
          !err.message.includes(PRIVATE))
      await assert.rejects(access(outputDir), { code: 'ENOENT' })
      assert.equal((await readFile(f.probeFile, 'utf8')).includes(PRIVATE), true)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
}
