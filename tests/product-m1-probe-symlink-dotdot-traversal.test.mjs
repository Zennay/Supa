import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveDomCandidateReview } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

// Test only. A symlink/.. path is resolved differently by filesystem traversal
// than by path.resolve(), which removes the alias component before lstat.
const SOURCE = RESEARCH_SOURCES.find(x => x.id === 'dirk-halvarine')
const NOW = Date.parse('2026-10-11T00:30:00.000Z')
const STAMP = new Date(NOW - 60_000).toISOString()
const STEM = 'capture-' + (NOW - 60_000) + '-5000'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-probe-dotdot-'))
  const captureDir = join(root, 'captures')
  const sourceDir = join(captureDir, SOURCE.id)
  await mkdir(sourceDir, { recursive: true, mode: 0o700 })
  const body = Buffer.from('<html>local test only</html>')
  await writeFile(join(sourceDir, STEM + '.html'), body, { mode: 0o600 })
  await writeFile(join(sourceDir, STEM + '.json'), JSON.stringify({
    version: 1, type: 'research-only-not-price-proof',
    sourceId: SOURCE.id, store: SOURCE.store, url: SOURCE.url,
    observedAt: STAMP, httpStatus: 200, mediaType: 'text/html',
    bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'),
    proxyMode: 'direct',
  }), { mode: 0o600 })
  const targetRoot = join(root, 'target')
  const nested = join(targetRoot, 'nested')
  await mkdir(nested, { recursive: true, mode: 0o700 })
  const probe = join(targetRoot, 'probe.json')
  await writeFile(probe, JSON.stringify({
    version: 1, kind: 'rendered-dom-candidate-only',
    originHost: new URL(SOURCE.url).hostname, capturedAt: STAMP,
    selectors: [], actualClassCandidates: [],
    note: 'SYNTHETIC-SECRET-NEVER-IN-DIAGNOSTICS',
  }), { mode: 0o600 })
  const run = (probePath, outputDir) => saveDomCandidateReview({
    sourceId: SOURCE.id, stem: STEM, probePath, captureDir, outputDir, nowMs: NOW,
  })
  return { root, nested, run }
}

test('ordinary real-directory dotdot probe path preserves review-only behavior', async () => {
  const f = await fixture()
  try {
    // Preserve an intentional lexical /real-dir/../ path with no aliases.
    const plain = f.nested + '/../probe.json'
    const result = await f.run(plain, join(f.root, 'plain-output'))
    assert.equal(result.status, 'human-semantic-review-required')
    assert.equal(result.semanticVerified, false)
    assert.equal(result.livePriceVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('symlink before lexical dotdot must reject before private review output is created', async () => {
  const f = await fixture()
  try {
    const alias = join(f.root, 'alias-dir')
    await symlink(f.nested, alias)
    // Deliberately do not path.join/resolve: they erase the symlink component.
    const aliasedInput = alias + '/../probe.json'
    const outputDir = join(f.root, 'aliased-output')
    await assert.rejects(f.run(aliasedInput, outputDir), err =>
      err instanceof Error && /private DOM candidate report rejected/.test(err.message) &&
      !err.message.includes('SYNTHETIC-SECRET'))
    await assert.rejects(access(outputDir), { code: 'ENOENT' })
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
