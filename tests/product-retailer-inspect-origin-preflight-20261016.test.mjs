import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main } from '../scripts/retailer-inspect-snapshot-cli.mjs'

const html = '<main><article class="product-card">offline fictional</article></main>'
const sha = createHash('sha256').update(html).digest('hex')
const timestamp = '2026-10-14T12:00:00.000Z'
const noPath = '/__supa_nonexistent_private_snapshot_origin_preflight__/never-open.html'

test('offline inspection rejects source-host spoofing before any local path lookup', async () => {
  for (const [retailer, url] of [
    ['plus', 'https://www.dekamarkt.nl/producten'],
    ['dekamarkt', 'https://www.plus.nl/producten'],
    ['plus', 'https://www.plus.nl.fake.example/products'],
    ['dekamarkt', 'https://dekamarkt.example.test/producten'],
  ]) {
    let output = ''
    await assert.rejects(
      main([retailer, url, timestamp, sha, noPath], chunk => { output += chunk }),
      /Invalid or oversized offline retailer snapshot/,
    )
    assert.equal(output, '')
  }
})

test('offline inspection rejects impossible civil dates before private path access', async () => {
  for (const date of [
    '2026-02-30T12:00:00.000Z',
    '2025-02-29T12:00:00.000Z',
    '2026-04-31T12:00:00.000Z',
    '2026-10-14T24:00:00.000Z',
  ]) {
    await assert.rejects(
      main(['plus', 'https://www.plus.nl/producten', date, sha, noPath]),
      /Invalid or oversized offline retailer snapshot/,
    )
  }
})

test('approved offline inspector still reads checked bytes and emits only safe review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-inspect-origin-'))
  try {
    const path = join(root, 'review.html')
    await writeFile(path, html, { mode: 0o600 })
    for (const [id, url] of [
      ['plus', 'https://www.plus.nl/producten'],
      ['dekamarkt', 'https://www.dekamarkt.nl/producten'],
      ['fictional-retailer', 'https://fictional.example/catalog'],
    ]) {
      let output = ''
      const report = await main([id, url, timestamp, sha, path], chunk => { output += chunk })
      assert.equal(report.source.retailerId, id)
      assert.equal(report.source.sha256, sha)
      assert.equal(report.source.capturedAt, timestamp)
      assert.equal(report.permissionVerified, false)
      assert.equal(report.readyForIngestion, false)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.deepEqual(JSON.parse(output), report)
      assert.doesNotMatch(output, /offline fictional|\.html|www\.plus\.nl|www\.dekamarkt\.nl/i)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
