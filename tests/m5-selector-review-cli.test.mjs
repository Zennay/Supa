import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const html = (price) => [
  '<!doctype html><html><head>',
  '<script type="application/ld+json">',
  JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'Private synthetic example', sku: 'FICTIONAL-01',
    offers: { '@type': 'Offer', price, priceCurrency: 'EUR' },
  }),
  '</script></head><body>EXAMPLE-BODY</body></html>',
].join('')

async function createCapture(root, name, price, shaOverride = null) {
  const dir = path.join(root, name)
  await mkdir(path.join(dir, 'fictional'), { recursive: true })
  const document = html(price)
  await writeFile(path.join(dir, 'fictional', 'fictional-product.html'), document)
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: 'fictional-product', supermarket: 'fictional', kind: 'product',
      requestedUrl: 'https://example.invalid/fictional-product',
      capturedAt: name === 'before' ? '2026-10-12T00:00:00.000Z' : '2026-10-13T00:00:00.000Z',
      sha256: shaOverride ?? createHash('sha256').update(document).digest('hex'),
      success: true,
    }],
  }))
  return dir
}

test('actual CLI reuses M1 integrity and never emits synthetic prices, URLs or source identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m5-review-cli-'))
  try {
    const before = await createCapture(root, 'before', '1.29')
    const after = await createCapture(root, 'after', '2.89')
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types', cli, after, before], {
      encoding: 'utf8', timeout: 10000,
    })
    const report = JSON.parse(stdout)
    assert.equal(report.sourceCount, 1)
    assert.equal(report.driftCount, 0)
    assert.equal(report.actions[0].status, 'content_changed_shape_stable')
    assert.equal(report.actions[0].action, 'review_content_and_extraction')
    assert.equal(report.actions[0].priority, 'P2')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.equal(report.actions[0].productionEnabled, false)
    assert.match(report.actions[0].sourceToken, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(stdout, /1\.29|2\.89|example\.invalid|fictional-product|Private synthetic|FICTIONAL-01/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('actual CLI refuses tampered SHA-256 without printing a reviewer queue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m5-review-bad-'))
  try {
    const after = await createCapture(root, 'after', '1.29', '0'.repeat(64))
    const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, after], {
      encoding: 'utf8', timeout: 10000,
    })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.stderr, /Private synthetic|example\.invalid|fictional-product|1\.29/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
