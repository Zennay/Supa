import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../scripts/m4-validate-beta-session.mjs', import.meta.url))

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m4-output-qa-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const session = {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-abandoned-001',
    participantKey: 'opaque-fixture-only',
    population: 'fictional student cohort',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    // Artificial fixture gate ONLY: genuine M3 #78 is OPEN, not eligible for real M4 beta.
    m3Gate: { status: 'closed', evidenceRef: 'artificial-test-fixture-no-human-evidence' },
    startedAt: '2026-10-10T10:00:00.000Z',
    endedAt: '2026-10-10T10:15:00.000Z',
    events: [{
      type: 'beta_session_started',
      timestamp: '2026-10-10T10:00:00.000Z',
      participant_id: 'opaque-fixture-only',
      study_week_id: 'fictional-001',
    }],
  }
  const input = join(dir, 'source-session.json')
  const bytes = JSON.stringify(session, null, 2) + '\n'
  writeFileSync(input, bytes, { mode: 0o600 })
  return {
    dir, input, bytes,
    run(args) {
      const result = spawnSync(process.execPath, [cli, input, ...args], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, NO_COLOR: '1' },
      })
      assert.equal(result.error, undefined, result.error?.message)
      return result
    },
    assertSourceUntouched() {
      assert.equal(readFileSync(input, 'utf8'), bytes)
    },
  }
}

test('positive: explicit distinct --output stays private, writes only requested file and retains source bytes', (t) => {
  const f = fixture(t)
  const target = join(f.dir, 'summary.json')
  const result = f.run(['--output', target])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  const report = JSON.parse(readFileSync(target, 'utf8'))
  assert.equal(report.reportType, 'm4-private-beta-session-summary')
  assert.equal(report.sessionOutcome, 'abandoned')
  assert.equal(report.publicClaimEligible, false)
  assert.equal(report.participantKeyIncluded, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(JSON.stringify(report).includes('opaque-fixture-only'), false)
  f.assertSourceUntouched()
  assert.deepEqual(readdirSync(f.dir).sort(), ['source-session.json', 'summary.json'])
})

test('positive: omitted --output is an intentional stdout-only operation (unlike missing value)', (t) => {
  const f = fixture(t)
  const result = f.run([])
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.sessionOutcome, 'abandoned')
  assert.equal(report.publicClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.deepEqual(readdirSync(f.dir), ['source-session.json'])
  f.assertSourceUntouched()
})

test('positive: empty --output value is rejected before any report is published', (t) => {
  const f = fixture(t)
  const result = f.run(['--output', '  '])
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /--output requires a file path/)
  assert.deepEqual(readdirSync(f.dir), ['source-session.json'])
  f.assertSourceUntouched()
})

test('expected RED: missing --output destination must error, not leak a private summary to stdout', (t) => {
  const f = fixture(t)
  const result = f.run(['--output'])
  assert.notEqual(result.status, 0, 'missing output value must be invalid CLI syntax')
  assert.equal(result.stdout, '', 'explicit but incomplete file-output request must never publish JSON to stdout')
  assert.deepEqual(readdirSync(f.dir), ['source-session.json'])
  f.assertSourceUntouched()
})

test('expected RED: repeated --output must reject instead of silently selecting a second destination', (t) => {
  const f = fixture(t)
  const first = join(f.dir, 'first.json')
  const second = join(f.dir, 'second.json')
  const result = f.run(['--output', first, '--output', second])
  assert.notEqual(result.status, 0, 'duplicate output destinations are ambiguous')
  assert.equal(result.stdout, '')
  assert.equal(existsSync(first), false)
  assert.equal(existsSync(second), false)
  assert.deepEqual(readdirSync(f.dir), ['source-session.json'])
  f.assertSourceUntouched()
})

test('expected RED: --output must not interpret another option token as an output filename', (t) => {
  const f = fixture(t)
  const result = f.run(['--output', '--output'])
  assert.notEqual(result.status, 0, 'flag-valued output is not a file destination')
  assert.equal(result.stdout, '')
  assert.equal(existsSync(join(f.dir, '--output')), false)
  assert.deepEqual(readdirSync(f.dir), ['source-session.json'])
  f.assertSourceUntouched()
})
