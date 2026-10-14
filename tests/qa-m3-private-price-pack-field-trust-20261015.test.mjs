import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// Independent M3 private-CLI validation of *individual input fields*, not
// another product implementation. All 11+11 items and prices are fictional.
// A malformed single field must not silently become a zero-priced saving.
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

function privateRun(script, input, output, root) {
  const proc = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, input, '--output', output],
    { cwd: root, encoding: 'utf8', timeout: 30000 },
  )
  assert.equal(proc.status, 0, proc.stderr)
  assert.equal(proc.stdout, '')
  assert.equal(proc.stderr, '')
  assert.equal(statSync(output).mode & 0o777, 0o600)
  return JSON.parse(readFileSync(output, 'utf8'))
}

const malformedFields = [
  { name: 'no price', field: 'priceCents', value: null },
  { name: 'negative price', field: 'priceCents', value: -1 },
  { name: 'fractional cent', field: 'priceCents', value: 10.5 },
  { name: 'string price', field: 'priceCents', value: '100' },
  { name: 'unsafe integer price', field: 'priceCents', value: Number.MAX_SAFE_INTEGER + 1 },
  { name: 'zero pack quantity', field: 'packAmount', value: 0 },
  { name: 'negative pack quantity', field: 'packAmount', value: -0.144 },
  { name: 'nonfinite pack quantity', field: 'packAmount', value: Number.POSITIVE_INFINITY },
  { name: 'zero items per pack', field: 'packCount', value: 0 },
  { name: 'non-integer items per pack', field: 'packCount', value: 1.5 },
  { name: 'unknown unit', field: 'packUnit', value: 'unknown' },
  { name: 'incompatible unit family', field: 'packUnit', value: 'ml' },
]

for (const side of ['baseline', 'candidate']) {
  test(`private M3 CLIs fail closed on all malformed individual ${side} prices and packs`, () => {
    for (const { name, field, value } of malformedFields) {
      const root = mkdtempSync(join(tmpdir(), 'supa-qa-field-trust-'))
      try {
        const sheet = buildFictionalPricedSheet(90)
        const index = sheet.requirements.findIndex(
          (demand) => demand.amount === 450 && demand.unit === 'g',
        )
        assert.notEqual(index, -1)
        sheet[side].lines[index].observedProduct[field] = value
        const input = join(root, 'source-private.json')
        const studyPath = join(root, 'study-private.json')
        const reportPath = join(root, 'report-private.json')
        const originalBytes = JSON.stringify(sheet)
        writeFileSync(input, originalBytes, { mode: 0o600 })

        const study = privateRun(converter, input, studyPath, root)
        const line = study[side].basket.lines[index]
        assert.equal(line.status, 'unresolved', `${side}: ${name}`)
        assert.equal(Object.hasOwn(line, 'lineTotalCents'), false, `${side}: ${name}`)
        assert.equal(study[side].basket.matchedLineCount, 10)
        assert.equal(study[side].basket.unresolvedLineCount, 1)
        assert.equal(study[side].basket.totalCents, side === 'baseline' ? 1000 : 900)

        const report = privateRun(assessor, studyPath, reportPath, root)
        assert.equal(report.outcome, 'unknown', `${side}: ${name}`)
        assert.equal(report.claimable, false)
        assert.equal(report.savingsCents, null)
        assert.equal(report.deltaCents, null)
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal(Object.hasOwn(report, 'participantKey'), false)
        assert.doesNotMatch(JSON.stringify(report), /fictional-operator-key/)
        assert.equal(readFileSync(input, 'utf8'), originalBytes)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
}

test('a genuinely zero-cent observed candidate is priced, not a missing or untrusted field', () => {
  const root = mkdtempSync(join(tmpdir(), 'supa-qa-zero-price-'))
  try {
    const sheet = buildFictionalPricedSheet(0)
    const input = join(root, 'source.json')
    const studyPath = join(root, 'study.json')
    const reportPath = join(root, 'report.json')
    const originalBytes = JSON.stringify(sheet)
    writeFileSync(input, originalBytes, { mode: 0o600 })
    const study = privateRun(converter, input, studyPath, root)
    assert.equal(study.candidate.basket.matchedLineCount, 11)
    assert.equal(study.candidate.basket.unresolvedLineCount, 0)
    assert.equal(study.candidate.basket.totalCents, 0)
    const report = privateRun(assessor, studyPath, reportPath, root)
    assert.equal(report.outcome, 'better')
    assert.equal(report.claimable, true)
    assert.equal(report.baselineTotalCents, 1100)
    assert.equal(report.candidateTotalCents, 0)
    assert.equal(report.savingsCents, 1100)
    assert.equal(report.publicSavingsClaimEligible, false, 'fictional cents are not public retailer evidence')
    assert.equal(readFileSync(input, 'utf8'), originalBytes)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
