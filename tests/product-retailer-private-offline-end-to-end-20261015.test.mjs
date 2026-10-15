import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { runPrivateRetailerPipeline, main } from '../scripts/retailer-private-offline-end-to-end.mjs'
import { RETAILER_REVIEWED_FIXTURES, loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

async function staged() {
  const dir = await mkdtemp(join(tmpdir(), 'supa-private-end-to-end-'))
  for (let i = 0; i < RETAILER_REVIEWED_FIXTURES.length; i++) {
    const bytes = await readFile(new URL('../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[i], import.meta.url))
    await writeFile(join(dir, 'capture-' + i + '.json'), bytes, {
      mode: 0o600, flag: 'wx',
    })
  }
  return dir
}

describe('product: staged private six-retailer-adapter one-command pipeline', () => {
  it('real six PLUS/Deka evidence sources → SHA manifest → six adapters → catalog', async () => {
    const dir = await staged()
    try {
      const summary = await runPrivateRetailerPipeline(dir)
      const expected = await loadReviewedRepositoryFixtures()
      assert.equal(summary.manifestCreated, true)
      assert.equal(summary.pinnedSources, 6)
      assert.equal(summary.acceptedSources, 6)
      assert.equal(summary.observations, expected.summary.observations)
      assert.ok(summary.products > 0)
      assert.ok(summary.captureEvents > 0)
      assert.equal(summary.humanReviewRequired, true)
      assert.equal(summary.permissionVerified, false)
      assert.equal(summary.productionEnabled, false)
      assert.equal(summary.livePricesAvailable, false)
      assert.equal(summary.publicSavingsClaimEligible, false)
      assert.equal(summary.externalRequests, 0)
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
      assert.equal(manifest.sources.length, 6)
      for (const row of manifest.sources) {
        assert.equal(row.sha256, createHash('sha256').update(
          await readFile(join(dir, row.file)),
        ).digest('hex'))
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('only prints aggregates: no names, currency, SKUs, retailer URLs or SHA', async () => {
    const dir = await staged()
    try {
      let stdout = ''
      const result = await main(['--dir', dir], text => { stdout += text })
      assert.deepEqual(JSON.parse(stdout), result)
      assert.equal(stdout.includes('plus:'), false)
      assert.equal(stdout.includes('dekamarkt:'), false)
      assert.equal(stdout.includes('currentPriceCents'), false)
      assert.equal(stdout.includes('EUR'), false)
      assert.equal(stdout.includes('capture-'), false)
      const batch = await loadReviewedRepositoryFixtures()
      for (const row of batch.results) {
        for (const fact of row.observations) {
          assert.equal(stdout.includes(fact.name), false)
          assert.equal(stdout.includes(fact.provenance.url), false)
          assert.equal(stdout.includes(fact.provenance.sha256), false)
        }
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('fails closed before a manifest is made for incomplete reviewed evidence', async () => {
    const dir = await staged()
    try {
      const name = join(dir, 'capture-0.json')
      const record = JSON.parse(await readFile(name, 'utf8'))
      record.source.supermarket = 'imaginary-shop'
      await writeFile(name, JSON.stringify(record), { mode: 0o600 })
      await assert.rejects(runPrivateRetailerPipeline(dir), /refused/)
      await assert.rejects(readFile(join(dir, 'manifest.json')))
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('never clobbers the source manifest on accidental re-run', async () => {
    const dir = await staged()
    try {
      await runPrivateRetailerPipeline(dir)
      const before = await readFile(join(dir, 'manifest.json'))
      await assert.rejects(runPrivateRetailerPipeline(dir), /refused/)
      assert.deepEqual(await readFile(join(dir, 'manifest.json')), before)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('pure API refuses arbitrary client options including public publishing', async () => {
    const dir = await staged()
    try {
      await assert.rejects(runPrivateRetailerPipeline(dir, { publicSavingsClaimEligible: true }), /refused/)
      await assert.rejects(readFile(join(dir, 'manifest.json')))
      await assert.rejects(runPrivateRetailerPipeline(dir, null), /refused/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('rejects CLI publish flags without stdout or a generated catalog', async () => {
    let output = ''
    await assert.rejects(main(['--publish'], text => { output += text }), /refused/)
    assert.equal(output, '')
  })
})
