import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main } from '../scripts/retailer-inspect-snapshot-cli.mjs'

test('approved offline snapshot + SHA yields privacy-safe selector report for human or AI review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-snapshot-'))
  try {
    const html = '<html><body><article class="product-card"><h3 class="product-name">Secret-ish test name</h3><span class="price-value">€10</span></article></body></html>'
    const path = join(root, 'sample.html')
    await writeFile(path, html)
    const sha = createHash('sha256').update(html).digest('hex')
    let logged = ''
    const result = await main(['fake-retailer','https://fixture.example/products','2026-10-14T11:00:00.000Z',sha,path], chunk => { logged += String(chunk) })
    assert.deepEqual(JSON.parse(logged), result)
    assert.equal(result.source.sha256, sha)
    assert.ok(result.selectors.some(x => x.field === 'name'))
    assert.ok(result.selectors.some(x => x.field === 'price'))
    assert.equal(result.readyForIngestion, false)
    assert.doesNotMatch(logged, /Secret-ish|€10|fixture\.example|sample\.html/)
  } finally {
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

test('offline inspector rejects symlink and hardlink aliases before reading snapshots', async () => {
  const { symlink, link } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'supa-inspector-alias-'))
  try {
    const file = join(root, 'original.html')
    const alias = join(root, 'alias.html')
    const hardlink = join(root, 'linked.html')
    const html = '<article class="product-card">Synthetic only</article>'
    await writeFile(file, html)
    const sha = createHash('sha256').update(html).digest('hex')
    const prefix = ['fake-retailer', 'https://fixture.example/products', '2026-10-14T11:00:00.000Z', sha]
    await symlink(file, alias)
    await assert.rejects(main([...prefix, alias], () => {
      throw Error('must not publish')
    }), /ELOOP|symbolic|single-link/)
    await link(file, hardlink)
    await assert.rejects(main([...prefix, hardlink], () => {
      throw Error('must not publish')
    }), /single-link/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CLI excludes identifier-bearing CSS selectors and testids from stdout, retaining generic hints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-privacy-selector-'))
  try {
    const html = [
      '<article class="product-secret-sku-12345 product-card">',
      '<span class="price-secret-cents-199 price-value" data-testid="price-private-199">€1,99</span>',
      '<span data-testid="pack-size">200 ml</span></article>',
    ].join('')
    const path = join(root, 'snapshot.html')
    await writeFile(path, html)
    let stdout = ''
    const report = await main([
      'plus', 'https://www.plus.nl/producten', '2026-10-14T12:00:00.000Z',
      createHash('sha256').update(html).digest('hex'), path,
    ], chunk => { stdout += String(chunk) })
    assert.equal(report.privateSelectorCount, 3)
    assert.ok(report.selectors.some(row => row.selector === 'article.product-card'))
    assert.ok(report.selectors.some(row => row.selector === 'span.price-value'))
    assert.ok(report.selectors.some(row => row.selector === 'span[data-testid="pack-size"]'))
    assert.doesNotMatch(stdout, /secret-sku-12345|secret-cents-199|private-199|€1,99|200 ml/)
    assert.equal(report.productionEnabled, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
