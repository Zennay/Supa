import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { compareReviewedDirectories } from '../scripts/retailer-private-reviewed-directory-diff.mjs'

// Independent full CLI / private filesystem acceptance for two physically
// separate SHA-pinned historical M1 six-shape archives. The modified archive
// is intentionally FICTIONAL: no retailer HTTP, license or current prices.
const referenceTime = '2026-10-15T21:00:00.000Z'
const later = '2026-10-14T12:00:00.000000001Z'
const earlier = '2026-10-03T10:00:00.000Z'
const fakeSha = 'b'.repeat(64)

async function archive(replacementTime = null) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-private-history-'))
  const manifest = {
    schemaVersion: 1,
    mode: 'private-reviewed-retailer-batch',
    productionEnabled: false,
    permissionVerified: false,
    publicSavingsClaimEligible: false,
    sources: [],
  }
  try {
    for (const file of RETAILER_REVIEWED_FIXTURES) {
      const sourceBytes = await readFile(new URL('../fixtures/m1/' + file, import.meta.url))
      const record = JSON.parse(sourceBytes.toString('utf8'))
      let bytes = sourceBytes
      if (record.source.supermarket === 'plus' && record.source.kind === 'catalog' &&
          replacementTime !== null) {
        assert.equal(record.cards.length, 4, 'requires the real reviewed four-card PLUS catalog')
        record.source.capturedAt = replacementTime
        record.source.sha256 = fakeSha
        record.browserEvidence.renderedHtmlSha256 = fakeSha
        for (const [i, card] of record.cards.entries()) {
          // Keep valid PLUS product URLs but replace ALL IDs. The original
          // retailer/route/selector/data shape remain canonical M1.
          assert.match(card.href, /-\d+$/)
          card.href = card.href.replace(/-\d+$/, '-' + String(910000 + i))
        }
        bytes = Buffer.from(JSON.stringify(record))
      }
      const name = 'capture-' + manifest.sources.length + '.json'
      await writeFile(join(dir, name), bytes, { mode: 0o600, flag: 'wx' })
      manifest.sources.push({
        file: name,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        key: record.source.supermarket + ':' + record.source.kind,
      })
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), {
      mode: 0o600, flag: 'wx',
    })
    return dir
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

async function withPair(replacementTime, check) {
  const first = await archive()
  let second
  try {
    second = await archive(replacementTime)
    return await check(first, second)
  } finally {
    await rm(first, { recursive: true, force: true })
    if (second) await rm(second, { recursive: true, force: true })
  }
}

test('QA control: two independent signed archival directories contain zero product drift', async () => {
  await withPair(null, async (before, after) => {
    const report = await compareReviewedDirectories(before, after, { referenceTime })
    assert.equal(report.totals.added, 0)
    assert.equal(report.totals.missing, 0)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.sourceRightsVerified, false)
    assert.equal(report.externalRequests, 0)
  })
})

test('QA control: physically later signed capture with four changed SKU IDs reports private additions/removals', async () => {
  await withPair(later, async (before, after) => {
    const report = await compareReviewedDirectories(before, after, { referenceTime })
    assert.equal(report.perShape['plus:catalog'].added, 4)
    assert.equal(report.perShape['plus:catalog'].missing, 4)
    assert.equal(report.totals.added, 4)
    assert.equal(report.totals.missing, 4)
    assert.equal(report.livePricesAvailable, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.externalRequests, 0)
  })
})

test('QA fail-closed: older six-source private signed archive with all new catalog IDs is not newer price evidence', async () => {
  await withPair(earlier, async (before, after) => {
    await assert.rejects(
      compareReviewedDirectories(before, after, { referenceTime }),
      /refused/,
    )
  })
})

test('QA executable refuses backward disjoint-ID history without leaking private paths or emitting any aggregate', async () => {
  await withPair(earlier, async (before, after) => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      new URL('../scripts/retailer-private-reviewed-directory-diff.mjs', import.meta.url).pathname,
      '--before-dir', before, '--after-dir', after, '--at', referenceTime,
    ], { encoding: 'utf8', timeout: 20000 })
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Private retailer reviewed directory diff refused/)
    assert.equal(result.stderr.includes(before), false)
    assert.equal(result.stderr.includes(after), false)
    assert.equal(result.stderr.includes('www.plus.nl'), false)
  })
})
