import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../scripts/retailer-compare-local-snapshots.mjs'

// Independent QA 2/2: compose the M3 capture-clock and exact-source-byte
// repairs at the *report publication* boundary. Offline fictional bytes only.
// Never issue network requests or assert genuine retailer savings.
const goodClock = '2026-10-15T04:00:00Z'
const validPlus = Buffer.from('<html><body>Fictional PLUS preview \u{1F95B}</body></html>', 'utf8')
const validDeka = Buffer.from('\uFEFF<html><body>Fictional DekaMarkt preview \u{1F95B}</body></html>', 'utf8')
const invalidHtml = Buffer.concat([validPlus, Buffer.from([0xff])])
const invalidHtml2 = Buffer.concat([validDeka, Buffer.from([0xed, 0xa0, 0x80])])

async function sourceSet(t, {
  plus = validPlus,
  deka = validDeka,
  plusClock = goodClock,
  dekaClock = goodClock,
  manifestTail = null,
} = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-qa-m3-private-report-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'plus.html'), plus)
  await writeFile(join(folder, 'deka.html'), deka)
  const manifest = join(folder, 'manifest.json')
  const output = join(folder, 'private-report.json')
  await writeFile(manifest, JSON.stringify({
    version: 1,
    requirements: [{ id: 'milk', query: 'fictional milk', amount: 1000, unit: 'ml' }],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html',
        capturedAt: plusClock },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html',
        capturedAt: dekaClock },
    ],
  }) + (manifestTail ?? ''))
  return { manifest, output }
}

async function mustNotExist(output) {
  await assert.rejects(stat(output), { code: 'ENOENT' })
}

for (const [location, invalidClock] of [
  ['PLUS first', { plusClock: '2026-10-15T04:00:00' }],
  ['DekaMarkt later', { dekaClock: '2026-02-30T04:00:00Z' }],
]) {
  for (const [corruption, badSource] of [
    ['PLUS HTML', { plus: invalidHtml }],
    ['DekaMarkt HTML', { deka: invalidHtml2 }],
  ]) {
    test('M3 QA: invalid ' + location + ' clock wins over corrupted ' + corruption +
      ' and creates no report', async t => {
      const { manifest, output } = await sourceSet(t, { ...invalidClock, ...badSource })
      await assert.rejects(main([manifest, '--out', output]),
        /Invalid bounded offline snapshot/,
        'validate full manifest before reading a corrupt HTML source')
      await mustNotExist(output)
    })
  }
}

for (const [corruption, badSource] of [
  ['lone FF in PLUS', { plus: invalidHtml }],
  ['lone FF in DekaMarkt', { deka: invalidHtml }],
  ['surrogate sequence in PLUS', { plus: invalidHtml2 }],
  ['surrogate sequence in DekaMarkt', { deka: invalidHtml2 }],
]) {
  test('M3 QA: ' + corruption + ' must not publish any private money report', async t => {
    const { manifest, output } = await sourceSet(t, badSource)
    await assert.rejects(main([manifest, '--out', output]), /Invalid UTF-8/)
    await mustNotExist(output)
  })
}

test('M3 QA: valid multibyte and BOM captures produce private no-money report with original byte digests', async t => {
  const { manifest, output } = await sourceSet(t)
  await main([manifest, '--out', output])
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(report.format, 'supa-local-snapshot-comparison-v1')
  assert.match(report.warning, /Offline snapshot preview only/)
  assert.equal(report.captureSummary.length, 2)
  assert.deepEqual(report.captureSummary.map(x => x.sha256), [
    createHash('sha256').update(validPlus).digest('hex'),
    createHash('sha256').update(validDeka).digest('hex'),
  ])
  assert.equal(report.comparison.claimable, false)
  assert.equal(report.comparison.comparable, false)
  assert.equal(report.comparison.cheaperStore, null)
  assert.equal(report.comparison.savingsCents, null)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
})

test('M3 QA: pre-existing private report is never replaced by otherwise valid captures', async t => {
  const { manifest, output } = await sourceSet(t)
  const sentinel = '{"existing":"private-owner-data"}\n'
  await writeFile(output, sentinel, { mode: 0o600 })
  await assert.rejects(main([manifest, '--out', output]), /EEXIST/)
  assert.equal(await readFile(output, 'utf8'), sentinel)
})

test('M3 QA: malformed UTF-8 manifest fails before HTML parsing or report publication', async t => {
  const { manifest, output } = await sourceSet(t)
  const bytes = await readFile(manifest)
  await writeFile(manifest, Buffer.concat([bytes, Buffer.from([0xff])]))
  await assert.rejects(main([manifest, '--out', output]), /Invalid UTF-8/)
  await mustNotExist(output)
})
