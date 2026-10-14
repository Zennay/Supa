import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

const REPO = process.cwd()

function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'cli-clock-check-2026',
    participantKey: 'private-synthetic-participant',
    population: 'synthetic students', region: 'synthetic region',
    weekStart: '2026-09-28', priceContext: 'in-store',
  })
  for (const [side, retailer, id, offset, at] of [
    ['baseline', 'PLUS Leiden testfiliaal', 'plus-test', 20, '2026-10-04T12:00:00Z'],
    ['candidate', 'DekaMarkt Leiden testfiliaal', 'deka-test', 0, '2026-10-04T13:00:00Z'],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = side + '-cli-synthetic'
    observation.observedAt = at
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Synthetic fixture only.'
    observation.store = { id, name: retailer }
    observation.lines.forEach((line, index) => {
      const req = sheet.requirements[index]
      line.observedProduct = {
        productId: id + '-' + req.id, productName: req.query,
        packAmount: req.amount, packUnit: req.unit, packCount: 1,
        priceCents: 100 + index + offset, available: true,
        sourceUrl: '', note: 'Synthetic observation; no receipt exists.',
      }
    })
  }
  return sheet
}

test('real converter CLI refuses future JSON rather than writing a derived evidence artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-future-cli-'))
  try {
    const input = join(dir, 'synthetic-private-input.json')
    const output = join(dir, 'should-not-exist-study.json')
    const sheet = syntheticSheet()
    sheet.candidate.observedAt = '2099-10-10T08:00:00-05:00'
    writeFileSync(input, JSON.stringify(sheet), { mode: 0o600 })
    const proc = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-build-observed-study.mjs',
      input, '--output', output,
    ], { cwd: REPO, encoding: 'utf8' })
    assert.equal(proc.status, 1, proc.stderr)
    assert.equal(proc.stdout, '')
    assert.match(proc.stderr, /candidate\.observedAt must be a valid timestamp/)
    assert.doesNotMatch(proc.stderr, /private-synthetic-participant|synthetic-private-input|2099-10-10/)
    assert.equal(existsSync(output), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('real report CLI retains unknown/unclaimable outcome when bypassing converter with future JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-future-report-'))
  try {
    const input = join(dir, 'synthetic-private-study.json')
    const study = buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
    study.baseline.observedAt = '2099-10-10T12:00:00Z'
    study.candidate.observedAt = '2099-10-10T13:00:00Z'
    writeFileSync(input, JSON.stringify(study), { mode: 0o600 })
    const proc = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs',
      input,
    ], { cwd: REPO, encoding: 'utf8' })
    assert.equal(proc.status, 0, proc.stderr)
    const result = JSON.parse(proc.stdout)
    assert.equal(result.claimable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.savingsCents, null)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.doesNotMatch(proc.stdout, /private-synthetic-participant/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
