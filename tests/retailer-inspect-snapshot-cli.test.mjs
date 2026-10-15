import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main } from '../scripts/retailer-inspect-snapshot-cli.mjs'

test('approved offline snapshot + SHA yields privacy-safe selector report for human or AI review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-snapshot-'))
  const original = process.stdout.write
  try {
    const html = '<html><body><article class="product-card"><h3 class="product-name">Secret-ish test name</h3><span class="price-value">€10</span></article></body></html>'
    const path = join(root, 'sample.html')
    await writeFile(path, html)
    const sha = createHash('sha256').update(html).digest('hex')
    let logged = ''
    process.stdout.write = function (chunk) { logged += String(chunk); return true }
    const result = await main(['fake-retailer','https://fixture.example/products','2026-10-14T11:00:00.000Z',sha,path])
    assert.deepEqual(JSON.parse(logged), result)
    assert.equal(result.source.sha256, sha)
    assert.ok(result.selectors.some(x => x.field === 'name'))
    assert.ok(result.selectors.some(x => x.field === 'price'))
    assert.equal(result.readyForIngestion, false)
    assert.doesNotMatch(logged, /Secret-ish|€10|fixture\.example|sample\.html/)
  } finally {
    process.stdout.write = original
    await rm(root, { recursive: true, force: true })
  }
})

test('tampered snapshot and invalid manifest never return selector candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-snapshot-'))
  try {
    const path = join(root, 'fake.html')
    await writeFile(path, '<html><body>changed</body></html>')
    await assert.rejects(main(['retailer','https://fixture.example/','2026-10-14T11:00:00.000Z','f'.repeat(64),path]), /SHA does not match/)
    await assert.rejects(main([]), /Usage:/)
    await assert.rejects(main(['retailer','https://fixture.example/','2026-10-14T11:00:00.000Z','x',path]), /SHA-256 required/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
