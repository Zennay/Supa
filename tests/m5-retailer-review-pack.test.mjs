import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import {
  buildRetailerReviewPack,
  parseReviewPackArgs,
  renderReviewPackCsv,
  renderReviewPackMarkdown,
} from '../scripts/m5-build-retailer-review-pack.mjs'

const dataUrl = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const originalBytes = await readFile(dataUrl, 'utf8')
const original = JSON.parse(originalBytes)
const clone = () => structuredClone(original)

test('M5 review pack covers 17 candidates, only PLUS+DekaMarkt as existing research pair', () => {
  const input = clone()
  const pack = buildRetailerReviewPack(input)
  assert.equal(pack.sourceCount, 17)
  assert.equal(pack.productionReady, false)
  assert.deepEqual(pack.items.filter((item) => item.existingM1ProofPair)
    .map((item) => item.retailerId), ['dekamarkt', 'plus'])
  assert.deepEqual(pack.items.map((item) => item.retailerId),
    [...pack.items.map((item) => item.retailerId)].sort())
  assert.ok(pack.items.every((item) => item.productionEnabled === false &&
    item.sourceMechanism === 'unassessed' &&
    item.permissionEvidence === null &&
    item.marketListReference.startsWith('https://')))
  assert.equal(JSON.stringify(input), JSON.stringify(original), 'source mutated')
  assert.deepEqual(buildRetailerReviewPack(clone()), pack, 'not deterministic')
})

test('CSV is proper bounded row export with safe numeric and disabled source values', () => {
  const pack = buildRetailerReviewPack(clone())
  const csv = renderReviewPackCsv(pack)
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines.length, 18, 'header + all 17 retailers')
  assert.equal(lines[0].split(',').length, 14)
  assert.ok(lines.every((line) => line.startsWith('"') && line.endsWith('"')))
  assert.ok(lines.includes(lines.find((line) => line.includes('"plus"'))))
  assert.ok(csv.includes('"false"'))
  assert.ok(csv.includes('"unassessed"'))
  assert.ok(!csv.includes('"permitted"'))
})

test('CSV spreadsheet formula strings are inert, including full-width and hidden prefix', () => {
  for (const value of [
    '=HYPERLINK("https://example.invalid")',
    '+SUM(1,1)',
    '-2+3',
    '@SUM(1)',
    '＠SUM(1)',
    '\u200e=1+1',
  ]) {
    const input = clone()
    input.sources[0].name = value
    const csv = renderReviewPackCsv(buildRetailerReviewPack(input))
    const row = csv.split('\r\n').find((line) => line.includes('"albert-heijn"'))
    assert.ok(row, 'missing candidate CSV row')
    assert.ok(row.includes(',"\'') && !row.includes(',"='), 'unsafe CSV name: ' + value)
  }

  const input = clone()
  input.sources[0].name = 'Nettorama,"Extra"'
  const csv = renderReviewPackCsv(buildRetailerReviewPack(input))
  assert.ok(csv.includes('"Nettorama,""Extra"""'), 'CSV quotes must be escaped')
})

test('Markdown is an actionable review list, never proof or ingestion authorization', () => {
  const input = clone()
  input.sources[0].name = 'A|B <unsafe>'
  const md = renderReviewPackMarkdown(buildRetailerReviewPack(input))
  assert.match(md, /A\\\|B &lt;unsafe&gt;/)
  assert.match(md, /M3 is still open/)
  assert.match(md, /- \[ \] Read current terms, robots guidance/)
  assert.match(md, /No human review or official permission has been completed/)
  assert.equal((md.match(/\| disabled \|/g) || []).length, 17)
})

test('Argument parser rejects ambiguous format and write switches', () => {
  const ok = parseReviewPackArgs(['--format=json'])
  assert.equal(ok.format, 'json')
  for (const args of [
    ['--format=html'],
    ['--format=csv', '--format=json'],
    ['--output=/tmp/retailers.csv'],
    ['--format'],
    ['--delete'],
    ['first.json', 'second.json'],
  ]) {
    assert.throws(() => parseReviewPackArgs(args), undefined, JSON.stringify(args))
  }
})

test('CLI CSV/JSON/Markdown uses real fixture without network or file mutation', async () => {
  const cli = new URL('../scripts/m5-build-retailer-review-pack.mjs', import.meta.url)
  for (const format of ['csv', 'json', 'markdown']) {
    const run = spawnSync(process.execPath, [cli.pathname, '--format=' + format],
      { encoding: 'utf8', timeout: 20000 })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stderr, '')
    if (format === 'json') {
      const pack = JSON.parse(run.stdout)
      assert.equal(pack.sourceCount, 17)
      assert.equal(pack.productionReady, false)
    } else if (format === 'csv') {
      assert.equal(run.stdout.trimEnd().split('\r\n').length, 18)
    } else {
      assert.match(run.stdout, /Manual approval checklist/)
    }
  }
  assert.equal(await readFile(dataUrl, 'utf8'), originalBytes, 'source bytes changed')
})
