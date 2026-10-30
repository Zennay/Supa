import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main } from '../scripts/retailer-inspect-snapshot-cli.mjs'

test('approved offline snapshot + SHA yields privacy-safe selector report for human or AI review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-snapshot-'))
  try {
    const html = '<html><body><article class="product-card"><h3 class="product-name">Secret-ish test name</h3><span class="price-value">€10</span></article></body></html>'
    const path = join(root, 'sample.html')
    await writeFile(path, html, { mode: 0o600 })
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
    await writeFile(path, '<html><body>changed</body></html>', { mode: 0o600 })
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
    await writeFile(file, html, { mode: 0o600 })
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
    await writeFile(path, html, { mode: 0o600 })
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

test('CLI operator can see legitimate source-observed absolute product URL root selectors', async () => {
  for (const [retailerId, host, listing, productRoot] of [
    ['plus','www.plus.nl','/producten','/product/'],
    ['dekamarkt','www.dekamarkt.nl','/aanbiedingen','/producten/'],
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'supa-merchant-link-cli-'))
    try {
      const html = '<html><body>' +
        '<a href="https://' + host + productRoot + 'synthetic-321">Synthetic</a>' +
        '<a href="//' + host + productRoot + 'synthetic-999">Synthetic</a>' +
        '<div class="product-internal-sku-987">Sensitive</div></body></html>'
      const file = join(root, 'source.html')
      await writeFile(file, html, { mode: 0o600 })
      let output = ''
      const report = await main([
        retailerId, 'https://' + host + listing, '2026-10-14T11:00:00.000Z',
        createHash('sha256').update(html).digest('hex'), file,
      ], chunk => { output += String(chunk) })
      assert.ok(report.selectors.some(row =>
        row.selector === 'a[href^="https://' + host + productRoot + '"]'))
      assert.ok(report.selectors.some(row =>
        row.selector === 'a[href^="//' + host + productRoot + '"]'))
      assert.equal(report.privateSelectorCount, 1)
      assert.equal(report.productionEnabled, false)
      assert.doesNotMatch(output, /synthetic-321|synthetic-999|internal-sku-987|source\.html/i)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('human CLI review shows observed relative product link forms, never item URLs', async () => {
  for (const [retailerId, host, root] of [
    ['plus','www.plus.nl','product/'],
    ['dekamarkt','www.dekamarkt.nl','producten/'],
  ]) {
    const dir=await mkdtemp(join(tmpdir(),'supa-relative-link-preview-'))
    try {
      const markup='<html><head><base href="/"></head><body>' +
        '<a href="' + root + 'fake-101">SYNTHETIC</a>' +
        '<a href="./' + root + 'fake-202">SYNTHETIC</a>' +
        '<a href="../' + root + 'fake-303">SYNTHETIC</a>' +
        '</body></html>'
      const file=join(dir,'review.html')
      await writeFile(file,markup,{mode:0o600})
      let stdout=''
      const report=await main([
        retailerId,'https://' + host + '/aanbiedingen/week',
        '2026-10-14T11:00:00.000Z',
        createHash('sha256').update(markup).digest('hex'),file,
      ],part=>{stdout+=String(part)})
      assert.equal(report.selectors.filter(s=>s.field==='product').length,3)
      assert.ok(report.selectors.some(s=>s.selector==='a[href^="../'+root+'"]'))
      assert.equal(report.humanReviewRequired,true)
      assert.equal(report.readyForIngestion,false)
      assert.doesNotMatch(stdout,/fake-101|fake-202|fake-303|review\.html/i)
    } finally { await rm(dir,{recursive:true,force:true}) }
  }
})

test('CLI refuses world-readable HTML parents and symlinked ancestors before review', async () => {
  const { mkdir, chmod, symlink } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'supa-inspector-dir-'))
  try {
    const privatePath = join(root, 'private')
    const alias = join(root, 'alias')
    await mkdir(privatePath, { mode: 0o700 })
    await symlink(privatePath, alias, 'dir')
    const html = '<article class="product-card">Synthetic</article>'
    await writeFile(join(privatePath, 'capture.html'), html, { mode: 0o600 })
    const args = ['plus', 'https://www.plus.nl/producten', '2026-10-14T12:00:00.000Z',
      createHash('sha256').update(html).digest('hex')]
    await assert.rejects(main([...args, join(alias, 'capture.html')]), /symlinked M3 output parent/)
    await chmod(privatePath, 0o755)
    await assert.rejects(main([...args, join(privatePath, 'capture.html')]), /exclusive 0700/)
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('private inspector rejects group/world-readable HTML bytes even inside a 0700 directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-private-source-mode-'))
  try {
    const html = '<article class="product-card">Synthetic offline only</article>'
    const path = join(root, 'capture.html')
    await writeFile(path, html, { mode: 0o600 })
    const args = ['plus','https://www.plus.nl/producten','2026-10-14T12:00:00.000Z',
      createHash('sha256').update(html).digest('hex'),path]
    await chmod(path, 0o644)
    await assert.rejects(main(args), /single-link HTML file/)
    await chmod(path, 0o640)
    await assert.rejects(main(args), /single-link HTML file/)
    await chmod(path, 0o600)
    const report = await main(args, () => {})
    assert.equal(report.readyForIngestion, false)
    assert.equal(report.source.retailerId, 'plus')
  } finally { await rm(root, { recursive: true, force: true }) }
})
