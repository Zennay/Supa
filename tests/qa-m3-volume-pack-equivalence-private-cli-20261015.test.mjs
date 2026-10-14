import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// Independent volume-unit metamorphic control through actual converter and
// private assessor binaries. Existing mass-only CLI checks don't exercise
// 400 ml ↔ 0.4 l normalization. All 22 observed products are invented.
const scripts = [
  fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url)),
  fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url)),
]
const variants = [
  { label: '100 ml single', amount: 100, unit: 'ml', count: 1 },
  { label: '0.1 l single', amount: 0.1, unit: 'l', count: 1 },
  { label: '50 ml double', amount: 50, unit: 'ml', count: 2 },
  { label: '0.05 l double', amount: 0.05, unit: 'l', count: 2 },
]

test('400 ml actual private M3 study/report path is invariant for equivalent ml/l multipacks', () => {
  const summaries = []
  for (const variant of variants) {
    const root = mkdtempSync(join(tmpdir(), 'supa-m3-qa-volume-'))
    try {
      const sheet = buildFictionalPricedSheet(90)
      const index = sheet.requirements.findIndex(
        (line) => line.amount === 400 && line.unit === 'ml',
      )
      assert.notEqual(index, -1, 'canonical 11-item demand includes 400 ml coconut milk')
      const product = sheet.baseline.lines[index].observedProduct
      product.packAmount = variant.amount
      product.packUnit = variant.unit
      product.packCount = variant.count
      const original = JSON.stringify(sheet)
      const input = join(root, 'original-observations.json')
      const studyPath = join(root, 'converted-study.json')
      const reportPath = join(root, 'private-assessment.json')
      writeFileSync(input, original, { mode: 0o600 })
      for (const [offset, script] of scripts.entries()) {
        const output = offset === 0 ? studyPath : reportPath
        const currentInput = offset === 0 ? input : studyPath
        const run = spawnSync(process.execPath,
          ['--experimental-strip-types', script, currentInput, '--output', output],
          { cwd: root, encoding: 'utf8', timeout: 30000 },
        )
        assert.equal(run.status, 0, `${variant.label}: ${run.stderr}`)
        assert.equal(run.stdout, '')
        assert.equal(run.stderr, '')
        assert.equal(statSync(output).mode & 0o777, 0o600)
      }
      const study = JSON.parse(readFileSync(studyPath, 'utf8'))
      const line = study.baseline.basket.lines[index]
      assert.equal(line.status, 'matched', variant.label)
      assert.equal(line.packs, 4, variant.label)
      assert.equal(line.lineTotalCents, 400, variant.label)
      assert.equal(study.baseline.basket.matchedLineCount, 11)
      assert.equal(study.baseline.basket.totalCents, 1400, variant.label)
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      assert.equal(report.claimable, true)
      assert.equal(report.outcome, 'better')
      assert.equal(report.baselineTotalCents, 1400)
      assert.equal(report.candidateTotalCents, 990)
      assert.equal(report.savingsCents, 410)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(report, 'participantKey'), false)
      assert.equal(readFileSync(input, 'utf8'), original)
      summaries.push({
        packs: line.packs,
        lineTotalCents: line.lineTotalCents,
        basketCents: study.baseline.basket.totalCents,
        savedCents: report.savingsCents,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  for (const summary of summaries.slice(1)) {
    assert.deepEqual(summary, summaries[0], 'same physical volume must cost the same')
  }
})
