import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// M3 must be willing to report "same" or "worse", not just promote savings.
// Both supermarkets use the same fully fictional 11-line demand and decimal
// pack edge. No observed prices, user identifiers or public claims are created.
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

for (const [price, outcome, privateSavings] of [
  [90, 'better', 31350],
  [100, 'same', 0],
  [110, 'worse', -31350],
]) {
  test(`decimal-exact private 11+11 CLI comparison preserves ${outcome} outcome without claiming public savings`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'supa-qa-m3-three-outcomes-'))
    try {
      const sheet = buildFictionalPricedSheet(price)
      const riceIndex = sheet.requirements.findIndex((line) =>
        line.amount === 450 && line.unit === 'g')
      assert.notEqual(riceIndex, -1)
      for (const side of ['baseline', 'candidate']) {
        const product = sheet[side].lines[riceIndex].observedProduct
        // Same physical 0.144 g pack, different unit/multipack spelling
        // across retailers must never manufacture a better/worse result.
        product.packAmount = side === 'baseline' ? 0.144 : 0.000072
        product.packUnit = side === 'baseline' ? 'g' : 'kg'
        product.packCount = side === 'baseline' ? 1 : 2
      }
      const source = join(directory, 'sheet.json')
      const study = join(directory, 'study.json')
      const report = join(directory, 'report.json')
      const original = JSON.stringify(sheet)
      writeFileSync(source, original, { mode: 0o600 })
      for (const [script, input, output] of [
        [converter, source, study],
        [assessor, study, report],
      ]) {
        const run = spawnSync(process.execPath,
          ['--experimental-strip-types', script, input, '--output', output],
          { cwd: directory, encoding: 'utf8', timeout: 30000 })
        assert.equal(run.status, 0, `private M3 CLI failed: ${run.stderr}`)
        assert.equal(run.stdout, '')
        assert.equal(run.stderr, '')
        assert.equal(statSync(output).mode & 0o077, 0)
      }
      const converted = JSON.parse(readFileSync(study, 'utf8'))
      assert.equal(converted.baseline.basket.lines[riceIndex].packs, 3125)
      assert.equal(converted.candidate.basket.lines[riceIndex].packs, 3125)
      assert.equal(converted.baseline.basket.matchedLineCount, 11)
      assert.equal(converted.candidate.basket.matchedLineCount, 11)
      const evidence = JSON.parse(readFileSync(report, 'utf8'))
      assert.equal(evidence.baselineTotalCents, 313500)
      assert.equal(evidence.candidateTotalCents, 3135 * price)
      assert.equal(evidence.outcome, outcome)
      assert.equal(evidence.savingsCents, privateSavings)
      assert.equal(evidence.deltaCents, -privateSavings, 'delta is candidate minus baseline')
      assert.equal(evidence.claimable, true, 'synthetic local math can be internally assessed')
      assert.equal(evidence.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(evidence, 'participantKey'), false)
      assert.equal(existsSync(source), true)
      assert.equal(readFileSync(source, 'utf8'), original)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
