import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp, mkdir, readFile, writeFile, stat, rm, symlink, link, access,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  main,
  renderPrintablePrivateShoppingChecklist,
} from '../scripts/retailer-private-shopping-checklist-html.mjs'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

const product = (price, shop) => ({
  status: 'matched', productId: 'fake-' + shop, productName: 'Fictief havermout',
  packs: 2, packPriceCents: price, totalCents: price * 2,
  sourceUrl: 'https://source.invalid/secret-label?token=hidden',
})
function offlinePreview() {
  return {
    format: 'supa-local-snapshot-comparison-v1',
    warning: 'Offline only; no public savings evidence',
    captureSummary: [],
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      comparable: true, cheaperStore: 'dekamarkt', savingsCents: 20,
      stores: {
        plus: { complete: true, subtotalCents: 240 },
        dekamarkt: { complete: true, subtotalCents: 220 },
      },
      lines: [{ ingredientId: 'oats', ingredient: 'havermout',
        plus: product(120, 'plus'), dekamarkt: product(110, 'dekamarkt') }],
    },
  }
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-stored-preview-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'saved-report.json')
  await writeFile(file, JSON.stringify(offlinePreview()))
  return { dir, file }
}

test('saved offline JSON -> identical print lists with two stores and 0600 output, without source HTML', async t => {
  const { dir, file } = await fixture(t)
  const output = join(dir, 'print.html')
  const expected = renderPrintablePrivateShoppingChecklist(offlinePreview())
  const before = await readFile(file)
  const actual = await main(['--report', file, '--output', output])
  assert.equal(actual, expected)
  assert.equal(await readFile(output, 'utf8'), expected)
  assert.deepEqual(await readFile(file), before)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  assert.match(actual, /ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
  assert.match(actual, /ALLEEN OFFLINE TOTAAL DekaMarkt: €2,20/)
  assert.match(actual, /id="view-plus">Alleen PLUS/)
  assert.match(actual, /id="view-deka">Alleen DekaMarkt/)
  assert.doesNotMatch(actual, /secret-label|token=hidden|https:\/\/source\.invalid/)
})

const fictionalProductHtml = price =>
  '<html><script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', sku: 'fictional-oat-milk',
    name: 'Fictieve halfvolle melk', weight: { value: '1000 ml' },
    offers: { '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' },
  }) + '</script></html>'

test('actual local fake HTML -> saved report -> remove original captures -> private print works', async t => {
  const { dir } = await fixture(t)
  const plus = join(dir, 'plus.html')
  const deka = join(dir, 'deka.html')
  const manifest = join(dir, 'snapshots.json')
  await writeFile(plus, fictionalProductHtml('1.29'))
  await writeFile(deka, fictionalProductHtml('1.19'))
  const capturedAt = new Date(Date.now() - 30_000).toISOString()
  await writeFile(manifest, JSON.stringify({
    version: 1,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html', capturedAt },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html', capturedAt },
    ],
  }))
  const inspected = await compareLocalRetailerSnapshots(manifest)
  const saved = join(dir, 'actual-offline-snapshot-report.json')
  const payload = JSON.stringify(inspected)
  await writeFile(saved, payload)
  await rm(plus)
  await rm(deka)
  await rm(manifest)
  const output = join(dir, 'restored-print.html')
  const html = await main(['--report', saved, '--output', output])
  assert.equal(html, renderPrintablePrivateShoppingChecklist(inspected))
  assert.match(html, /2 hele verpakking/)
  assert.match(html, /ALLEEN OFFLINE TOTAAL PLUS: €2,58/)
  assert.match(html, /ALLEEN OFFLINE TOTAAL DekaMarkt: €2,38/)
  assert.match(html, /Geen live prijzen/)
  assert.equal(await readFile(saved, 'utf8'), payload)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
})

test('single-store renderer validates both inputs but emits no other shop product or price', () => {
  const report = offlinePreview()
  report.comparison.lines[0].plus.productName = 'PLUS-ONLY-PRODUCT-X7'
  report.comparison.lines[0].dekamarkt.productName = 'DEKA-PRIVATE-PRODUCT-Z9'
  const plus = renderPrintablePrivateShoppingChecklist(report, 'plus')
  const deka = renderPrintablePrivateShoppingChecklist(report, 'dekamarkt')
  assert.match(plus, /PLUS-ONLY-PRODUCT-X7/)
  assert.match(plus, /ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
  assert.doesNotMatch(plus, /DEKA-PRIVATE-PRODUCT-Z9|€2,20|DekaMarkt|name="storeView"/)
  assert.match(deka, /DEKA-PRIVATE-PRODUCT-Z9/)
  assert.match(deka, /ALLEEN OFFLINE TOTAAL DekaMarkt: €2,20/)
  assert.doesNotMatch(deka, /PLUS-ONLY-PRODUCT-X7|€2,40|PLUS|name="storeView"/)
  assert.match(plus, /class="grid single-shop"/)
  assert.match(deka, /class="grid single-shop"/)
  assert.match(plus, /Geen live prijzen/)
  assert.match(deka, /Geen live prijzen/)
  assert.throws(() => renderPrintablePrivateShoppingChecklist(report, 'aldi'),
    /Invalid private checklist shop selection/)
})

test('saved-report CLI writes two independently private single-store outputs, unchanged source', async t => {
  const { dir, file } = await fixture(t)
  const report = offlinePreview()
  report.comparison.lines[0].plus.productName = 'PLUS-PRIVATE-LABEL'
  report.comparison.lines[0].dekamarkt.productName = 'DEKA-PRIVATE-LABEL'
  await writeFile(file, JSON.stringify(report))
  const before = await readFile(file)
  const plusPath = join(dir, 'only-plus.html')
  const dekaPath = join(dir, 'only-dekamarkt.html')
  const plus = await main(['--report', file, '--output', plusPath, '--store', 'plus'])
  const deka = await main(['--report', file, '--output', dekaPath, '--store', 'dekamarkt'])
  assert.equal(await readFile(plusPath, 'utf8'), plus)
  assert.equal(await readFile(dekaPath, 'utf8'), deka)
  assert.deepEqual(await readFile(file), before)
  assert.equal((await stat(plusPath)).mode & 0o777, 0o600)
  assert.equal((await stat(dekaPath)).mode & 0o777, 0o600)
  assert.match(plus, /PLUS-PRIVATE-LABEL/)
  assert.doesNotMatch(plus, /DEKA-PRIVATE-LABEL|€2,20/)
  assert.match(deka, /DEKA-PRIVATE-LABEL/)
  assert.doesNotMatch(deka, /PLUS-PRIVATE-LABEL|€2,40/)
})

test('selected shop with unknown price prints unknown, without unrelated shop prices', () => {
  const report = offlinePreview()
  report.comparison.lines[0].dekamarkt.status = 'availability_unknown'
  const onlyDeka = renderPrintablePrivateShoppingChecklist(report, 'dekamarkt')
  assert.match(onlyDeka, /GEEN BETROUWBAAR VOLLEDIG TOTAAL DekaMarkt/)
  assert.doesNotMatch(onlyDeka, /ALLEEN OFFLINE TOTAAL|€2,40|€2,20/)
  assert.match(renderPrintablePrivateShoppingChecklist(report, 'plus'),
    /ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
})

test('store flag accepts only canonical retailer names at final position', async () => {
  for (const args of [
    ['--report', 'a.json', '--output', 'out.html', '--store', 'both'],
    ['--report', 'a.json', '--output', 'out.html', '--store', 'PLUS'],
    ['--report', 'a.json', '--output', 'out.html', '--store', 'other'],
    ['--report', 'a.json', '--output', 'out.html', '--store'],
    ['--report', 'a.json', '--output', 'out.html', '--store', 'plus', 'extra'],
  ]) {
    await assert.rejects(() => main(args), /Invalid private offline checklist HTML arguments/)
  }
})

test('saved incomplete shop does not turn a partial subtotal into a whole basket', async t => {
  const { dir, file } = await fixture(t)
  const data = offlinePreview()
  data.comparison.lines[0].dekamarkt.status = 'availability_unknown'
  await writeFile(file, JSON.stringify(data))
  const html = await main(['--report', file, '--output', join(dir, 'private.html')])
  assert.match(html, /ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
  assert.match(html, /GEEN BETROUWBAAR VOLLEDIG TOTAAL DekaMarkt/)
  assert.doesNotMatch(html, /ALLEEN OFFLINE TOTAAL DekaMarkt:/)
})

test('saved claimable or forged total report never publishes private HTML', async t => {
  const { dir, file } = await fixture(t)
  const target = join(dir, 'not-created.html')
  const bad = offlinePreview()
  bad.comparison.claimable = true
  await writeFile(file, JSON.stringify(bad))
  await assert.rejects(() => main(['--report', file, '--output', target]),
    /Invalid or claimable offline shopping checklist input/)
  await assert.rejects(access(target))
  bad.comparison.claimable = false
  bad.comparison.stores.plus.subtotalCents = 10000
  await writeFile(file, JSON.stringify(bad))
  const html = await main(['--report', file, '--output', target])
  assert.match(html, /GEEN BETROUWBAAR VOLLEDIG TOTAAL PLUS/)
  assert.doesNotMatch(html, /ALLEEN OFFLINE TOTAAL PLUS:/)
})

test('symbolic-link input is refused without touching its ordinary private source', async t => {
  const { dir, file } = await fixture(t)
  const alias = join(dir, 'linked-private.json')
  const output = join(dir, 'not-created.html')
  await symlink(file, alias)
  const before = await readFile(file)
  await assert.rejects(() => main(['--report', alias, '--output', output]),
    /Private offline comparison file could not be read/)
  assert.deepEqual(await readFile(file), before)
  await assert.rejects(access(output))
})

test('symlinked ancestor directory of saved report is refused before reading private content', async t => {
  const { dir } = await fixture(t)
  const actual = join(dir, 'real-capture')
  await mkdir(actual)
  const source = join(actual, 'saved.json')
  await writeFile(source, JSON.stringify(offlinePreview()))
  const aliasDir = join(dir, 'alias-capture')
  await symlink(actual, aliasDir, 'dir')
  const alias = join(aliasDir, 'saved.json')
  const output = join(dir, 'not-created.html')
  const before = await readFile(source)
  await assert.rejects(() => main(['--report', alias, '--output', output]),
    /Private offline comparison file could not be read/)
  assert.deepEqual(await readFile(source), before)
  await assert.rejects(access(output))
})

test('invalid UTF-8 private label is rejected without lossy decoding or partial HTML', async t => {
  const { dir, file } = await fixture(t)
  await writeFile(file, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]))
  const output = join(dir, 'not-created.html')
  await assert.rejects(() => main(['--report', file, '--output', output]),
    /Private offline comparison file could not be read/)
  await assert.rejects(access(output))
})

test('oversized private report is refused before JSON extraction', async t => {
  const { dir, file } = await fixture(t)
  await writeFile(file, 'x'.repeat(4 * 1024 * 1024 + 1))
  const output = join(dir, 'not-created.html')
  await assert.rejects(() => main(['--report', file, '--output', output]),
    /Private offline comparison file could not be read/)
  await assert.rejects(access(output))
})

test('saved report cannot be overwritten through hardlink output alias', async t => {
  const { dir, file } = await fixture(t)
  const output = join(dir, 'same-inode.html')
  await link(file, output)
  const before = await readFile(file)
  await assert.rejects(() => main(['--report', file, '--output', output]),
    /refusing to overwrite M3 evidence input with derived output/)
  assert.deepEqual(await readFile(output), before)
  assert.deepEqual(await readFile(file), before)
})

test('saved report output may not follow symlink to another private document', async t => {
  const { dir, file } = await fixture(t)
  const protectedFile = join(dir, 'private-sentinel.txt')
  await writeFile(protectedFile, 'protected document')
  const output = join(dir, 'linked-output.html')
  await symlink(protectedFile, output)
  await assert.rejects(() => main(['--report', file, '--output', output]),
    /refusing symlinked M3 derived output file/)
  assert.equal(await readFile(protectedFile, 'utf8'), 'protected document')
})

test('saved report flag syntax must be explicit, never silently reinterpreted as manifest', async () => {
  for (const args of [
    ['--report', 'a.json', '--output'],
    ['--report', '--output', 'file.html'],
    ['--report', 'file.json', '--output', 'printed.txt'],
    ['--report', 'file.json', 'printed.html'],
    ['--report', 'file.json', '--output', ' output.html '],
    ['--invalid', 'file.json', '--output', 'output.html'],
  ]) {
    await assert.rejects(() => main(args), /Invalid private offline checklist HTML arguments/)
  }
})
