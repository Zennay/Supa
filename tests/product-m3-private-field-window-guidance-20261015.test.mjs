import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildM3OutstandingFieldActions } from '../scripts/m3-private-outstanding-field-actions.mjs'

const CLI = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const NOW = Date.parse('2026-10-15T12:00:00Z')
const PRIVATE_MARKER = 'PRIVATE_TIMES_AND_CUSTOMER_MUST_NOT_PRINT'

function fixture(baselineAt = '', candidateAt = '') {
  const sheet = buildObservationSheet()
  sheet.study.participantKey = PRIVATE_MARKER
  sheet.baseline.observedAt = baselineAt
  sheet.candidate.observedAt = candidateAt
  sheet.baseline.provenanceNote = PRIVATE_MARKER
  return sheet
}

const cases = [
  {
    state: 'not-started', times: ['', ''],
    expected: 'nog geen geldige observatietijd; vul beide winkels in',
  },
  {
    state: 'single-observation', times: ['2020-01-01T08:00:00Z', ''],
    expected: 'de eerste meting is ouder dan 24 uur; meet beide winkels opnieuw',
  },
  {
    state: 'within-window', times: ['2020-01-01T08:00:00Z', '2020-01-02T08:00:00Z'],
    expected: 'twee geldige observatietijden binnen 24 uur; controleer alle overige velden',
  },
  {
    state: 'outside-window', times: ['2020-01-01T08:00:00Z', '2020-01-02T08:00:00.001Z'],
    expected: 'langer dan 24 uur uit elkaar; voer een nieuwe gekoppelde meting uit',
  },
]

test('M3 operator reports retain machine-readable window state without revealing source times', () => {
  for (const { state, times } of cases) {
    const report = buildM3OutstandingFieldActions(JSON.stringify(fixture(...times)), NOW)
    assert.equal(report.observationWindowState, state)
    assert.equal(report.observationWindowExpired, state === 'single-observation')
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.verifiedRetailerObservations, false)
    assert.equal(JSON.stringify(report).includes('2020-01-0'), false)
    assert.equal(JSON.stringify(report).includes(PRIVATE_MARKER), false)
  }
})

test('local Dutch CLI renders four coarse M3 window states with no dates, no sensitive free text', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-window-guidance-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'PRIVATE-WINDOW.json')
  for (const { state, times, expected } of cases) {
    await writeFile(path, JSON.stringify(fixture(...times)), { mode: 0o600 })
    for (const flags of [['--text'], ['--text', '--store', 'plus'], ['--text', '--store', 'dekamarkt']]) {
      const result = spawnSync(process.execPath,
        ['--experimental-strip-types', CLI, path, ...flags],
        { cwd: dir, encoding: 'utf8', timeout: 20_000 })
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(result.stdout, /Meetvenster: /)
      assert.equal(result.stdout.includes('2020-01'), false, state)
      assert.equal(result.stdout.includes(PRIVATE_MARKER), false, state)
      assert.equal(result.stdout.includes('PRIVATE-WINDOW.json'), false, state)
      assert.equal(result.stderr, '')
    }
  }
})

test('future observational time remains unstarted and is never shown to operators', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-future-window-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'private.json')
  const sheet = fixture('2099-01-01T08:00:00Z', '')
  await writeFile(path, JSON.stringify(sheet), { mode: 0o600 })
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, path, '--text'],
    { cwd: dir, encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Meetvenster: nog geen geldige observatietijd/)
  assert.equal(result.stdout.includes('2099'), false)
})

test('one observed store expires strictly after 24h (not at the exact boundary)', () => {
  const sheet = fixture('2026-10-14T12:00:00Z', '')
  const exactly24h = buildM3OutstandingFieldActions(JSON.stringify(sheet), NOW)
  const plusOneMs = buildM3OutstandingFieldActions(JSON.stringify(sheet), NOW + 1)
  assert.equal(exactly24h.observationWindowState, 'single-observation')
  assert.equal(exactly24h.observationWindowExpired, false)
  assert.equal(exactly24h.pendingMetadata.study.some(f => f.field === 'observationWindow'), false)
  assert.equal(plusOneMs.observationWindowState, 'single-observation')
  assert.equal(plusOneMs.observationWindowExpired, true)
  assert.equal(plusOneMs.pendingMetadata.study.some(f => f.field === 'observationWindow'), true)
  assert.equal(plusOneMs.publicSavingsClaimEligible, false)
  for (const report of [exactly24h, plusOneMs]) {
    assert.equal(JSON.stringify(report).includes('2026-10-14T12:00'), false)
    assert.equal(JSON.stringify(report).includes(PRIVATE_MARKER), false)
  }
})

test('recent private one-store observation gives feasible 24h action on real CLI clock', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-recent-single-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'recent.json')
  const observedAt = new Date(Date.now() - 60_000).toISOString()
  const sheet = fixture(observedAt, '')
  await writeFile(path, JSON.stringify(sheet), { mode: 0o600 })
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, path, '--text', '--store', 'plus'],
    { cwd: dir, encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Meetvenster: één winkel heeft een geldige observatietijd; meet de andere binnen 24 uur/)
  assert.doesNotMatch(result.stdout, /de eerste meting is ouder dan 24 uur/)
  assert.equal(result.stdout.includes(observedAt), false)
  assert.equal(result.stdout.includes(PRIVATE_MARKER), false)
})
