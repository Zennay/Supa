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
