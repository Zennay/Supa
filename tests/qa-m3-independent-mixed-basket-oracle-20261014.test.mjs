import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// Independent cent-integer oracle for deliberately non-uniform *fictional*
// store baskets. Unlike a uniform-price fixture, all 22 observed product
// prices vary by row, side and seed, with 1- and 2-pack buying quantities.
// Exercise real private source -> converter -> assessor CLIs, not mocks.
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))
const sides = ['baseline', 'candidate']

function runCli(script, input, output, root) {
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', script, input, '--output', output],
    { cwd: root, encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '', 'private JSON cannot appear on stdout')
  assert.equal(result.stderr, '', 'successful private work must be quiet')
  assert.equal(statSync(output).mode & 0o777, 0o600)
  return JSON.parse(readFileSync(output, 'utf8'))
}

function independentPrice(seed, side, index) {
  const baseline = (seed * 37 + index * 53 + (index % 3) * 7) % 367
  if (side === 'baseline' || seed === 0) return baseline
  if (seed === 1) return Math.max(0, baseline - 17)
  if (seed === 2) return baseline + 17
  return (seed * 101 + index * 43 + (side === 'candidate' ? 59 : 0)) % 499
}

test('sixteen variable 11+11 private M3 baskets agree with an independent exact-cent oracle', () => {
  const outcomes = new Set()
  for (let seed = 0; seed < 16; seed += 1) {
    const root = mkdtempSync(join(tmpdir(), 'supa-qa-mixed-11x11-'))
    try {
      const sheet = buildFictionalPricedSheet(90)
      const expected = { baseline: [], candidate: [] }
      for (const side of sides) {
        sheet[side].lines.forEach((line, index) => {
          const req = sheet.requirements[index]
          assert.equal(line.ingredientId, req.id)
          const product = line.observedProduct
          const divisible = req.unit === 'piece' ? 2 : 4
          const mode = (seed + index + (side === 'candidate' && seed >= 3 ? 1 : 0)) % 3
          // 1 package of full demand, 2 half-demand packages or
          // 2 physical quarter-demand items per multipack (2 multipacks).
          const divisor = mode === 0 ? 1 : mode === 1 ? 2 : divisible
          product.packAmount = req.amount / divisor
          product.packUnit = req.unit
          product.packCount = mode === 2 && req.unit !== 'piece' ? 2 : 1
          const packs = mode === 0 ? 1 : 2
          product.priceCents = independentPrice(seed, side, index)
          expected[side].push({
            id: req.id,
            packs,
            lineTotalCents: packs * product.priceCents,
          })
        })
      }

      const input = join(root, 'private-fictional-observations.json')
      const studyFile = join(root, 'private-study.json')
      const reportFile = join(root, 'private-report.json')
      const original = JSON.stringify(sheet)
      writeFileSync(input, original, { mode: 0o600 })
      const study = runCli(converter, input, studyFile, root)
      const report = runCli(assessor, studyFile, reportFile, root)

      const totals = {}
      for (const side of sides) {
        assert.equal(study[side].basket.lines.length, 11)
        assert.equal(study[side].basket.matchedLineCount, 11)
        assert.equal(study[side].basket.unresolvedLineCount, 0)
        const expectedLines = expected[side]
        expectedLines.forEach((oracle, index) => {
          const actual = study[side].basket.lines[index]
          assert.equal(actual.id, oracle.id, `${seed} ${side} line ${index}`)
          assert.equal(actual.status, 'matched')
          assert.equal(actual.packs, oracle.packs, `${seed} ${side} packs ${index}`)
          assert.equal(actual.lineTotalCents, oracle.lineTotalCents,
            `${seed} ${side} cents ${index}`)
        })
        totals[side] = expectedLines.reduce((sum, item) => sum + item.lineTotalCents, 0)
        assert.equal(study[side].basket.totalCents, totals[side])
      }

      const signedDifference = totals.baseline - totals.candidate
      const outcome = signedDifference > 0 ? 'better' :
        signedDifference < 0 ? 'worse' : 'same'
      outcomes.add(outcome)
      assert.equal(report.baselineTotalCents, totals.baseline)
      assert.equal(report.candidateTotalCents, totals.candidate)
      assert.equal(report.savingsCents, signedDifference)
      assert.equal(report.deltaCents, signedDifference === 0 ? 0 : -signedDifference,
        'equal baskets have canonical +0 delta, not -0')
      assert.equal(report.outcome, outcome)
      assert.equal(report.claimable, true)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(report.baseline.matchedLineCount, 11)
      assert.equal(report.candidate.matchedLineCount, 11)
      assert.equal(Object.hasOwn(report, 'participantKey'), false)
      assert.doesNotMatch(JSON.stringify(report), /fictional-operator-key/)
      assert.equal(readFileSync(input, 'utf8'), original,
        'source observations cannot be changed by arithmetic')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  assert.deepEqual([...outcomes].sort(), ['better', 'same', 'worse'],
    'mixed prices must cover all financially honest signs')
})
