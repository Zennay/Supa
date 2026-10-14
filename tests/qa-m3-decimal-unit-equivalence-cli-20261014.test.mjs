import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// Independent unit-conversion invariance at the *public CLI boundaries*.
// Every row is fictional. Exact equivalence is defined by decimal physical
// quantity, never a float multiplication of packAmount * packCount.
const variants = [
  { label: '0.144 g single', amount: 0.144, unit: 'g', count: 1 },
  { label: '0.072 g double', amount: 0.072, unit: 'g', count: 2 },
  { label: '0.000144 kg single', amount: 0.000144, unit: 'kg', count: 1 },
  { label: '0.000072 kg double', amount: 0.000072, unit: 'kg', count: 2 },
]

test('M3 full private CLI path is invariant under exact mass unit / multipack representation', () => {
  const summaries = []
  for (const variant of variants) {
    const root = mkdtempSync(join(tmpdir(), 'supa-qa-m3-pack-equivalence-'))
    try {
      const source = buildFictionalPricedSheet(90)
      const index = source.requirements.findIndex(
        (demand) => demand.amount === 450 && demand.unit === 'g',
      )
      assert.notEqual(index, -1)
      const product = source.baseline.lines[index].observedProduct
      product.packAmount = variant.amount
      product.packUnit = variant.unit
      product.packCount = variant.count
      const sheetFile = join(root, 'sheet.json')
      const studyFile = join(root, 'study.json')
      const reportFile = join(root, 'report.json')
      const originalBytes = JSON.stringify(source)
      writeFileSync(sheetFile, originalBytes, { mode: 0o600 })

      for (const [script, input, output] of [
        ['scripts/m3-build-observed-study.mjs', sheetFile, studyFile],
        ['scripts/m3-assess-observed-week.mjs', studyFile, reportFile],
      ]) {
        const run = spawnSync(process.execPath,
          ['--experimental-strip-types', script, input, '--output', output],
          { encoding: 'utf8', timeout: 20000 },
        )
        assert.equal(run.status, 0, `${variant.label} ${script}: ${run.stderr}`)
        assert.equal(run.stdout, '')
        assert.equal(run.stderr, '')
      }
      const study = JSON.parse(readFileSync(studyFile, 'utf8'))
      const line = study.baseline.basket.lines[index]
      assert.equal(line.status, 'matched', variant.label)
      assert.equal(line.packs, 3125, variant.label)
      assert.equal(line.lineTotalCents, 312500)
      assert.equal(study.baseline.basket.matchedLineCount, 11)
      assert.equal(study.baseline.basket.totalCents, 313500)
      const report = JSON.parse(readFileSync(reportFile, 'utf8'))
      assert.equal(report.outcome, 'better', variant.label)
      assert.equal(report.baselineTotalCents, 313500)
      assert.equal(report.candidateTotalCents, 990)
      assert.equal(report.savingsCents, 312510)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(readFileSync(sheetFile, 'utf8'), originalBytes)
      summaries.push({
        packs: line.packs,
        lineTotalCents: line.lineTotalCents,
        studyTotalCents: study.baseline.basket.totalCents,
        reportTotalCents: report.baselineTotalCents,
        privateDelta: report.savingsCents,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  for (const summary of summaries.slice(1)) {
    assert.deepEqual(summary, summaries[0], 'equivalent physical packs may not change quoted totals')
  }
})
