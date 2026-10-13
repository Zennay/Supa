import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../scripts/m4-validate-beta-session.mjs', import.meta.url))
const childSource = [
  "import { pathToFileURL } from 'node:url'",
  "process.umask(Number(process.env.QA_M4_UMASK))",
  "const { main } = await import(pathToFileURL(process.env.QA_M4_CLI).href)",
  "await main([process.env.QA_M4_INPUT, '--output', process.env.QA_M4_OUTPUT])",
].join('\n')

function fixture(t, gateStatus = 'closed') {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m4-private-mode-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // Intentional disposable shared-parent scenario; no real or person-identifying data.
  chmodSync(dir, 0o755)
  const input = join(dir, 'synthetic-source.json')
  const output = join(dir, 'private-report.json')
  const session = {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'fictional-abandoned-mode-test',
    participantKey: 'opaque-fixture-001',
    population: 'fictional cohort',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    // Artificial closed M3 is used only to exercise private output; genuine #78 OPEN.
    m3Gate: { status: gateStatus, evidenceRef: 'fictional-test-not-real-M3-approval' },
    startedAt: '2026-10-10T10:00:00.000Z',
    endedAt: '2026-10-10T10:01:00.000Z',
    events: [{
      type: 'beta_session_started',
      timestamp: '2026-10-10T10:00:00.000Z',
      participant_id: 'opaque-fixture-001',
      study_week_id: 'fictional-001',
    }],
  }
  const sourceBytes = JSON.stringify(session) + '\n'
  writeFileSync(input, sourceBytes, { mode: 0o600 })
  return {
    dir, input, output, sourceBytes,
    run(umask) {
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
        encoding: 'utf8',
        timeout: 10000,
        cwd: dir,
        env: {
          ...process.env,
          QA_M4_UMASK: String(umask),
          QA_M4_CLI: cli,
          QA_M4_INPUT: input,
          QA_M4_OUTPUT: output,
        },
      })
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(readFileSync(input, 'utf8'), sourceBytes)
      return result
    },
  }
}
function assertPrivateSummary(f) {
  const report = JSON.parse(readFileSync(f.output, 'utf8'))
  assert.equal(report.reportType, 'm4-private-beta-session-summary')
  assert.equal(report.sessionOutcome, 'abandoned')
  assert.equal(report.publicClaimEligible, false)
  assert.equal(report.participantKeyIncluded, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(JSON.stringify(report).includes('opaque-fixture-001'), false)
}
function permissions(path) { return statSync(path).mode & 0o777 }

test('positive: restrictive caller umask 077 creates a mode-0600 private M4 report', (t) => {
  const f = fixture(t)
  const result = f.run(0o077)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assertPrivateSummary(f)
  assert.equal(permissions(f.output), 0o600)
  assert.deepEqual(readdirSync(f.dir).sort(), ['private-report.json', 'synthetic-source.json'])
})

test('positive: genuine M3 gate remains closed to beta evidence and emits no file', (t) => {
  const f = fixture(t, 'open')
  const result = f.run(0o022)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(existsSync(f.output), false)
  assert.deepEqual(readdirSync(f.dir), ['synthetic-source.json'])
})

test('expected RED: new private report in shared parent is not group/world readable at umask 022', (t) => {
  const f = fixture(t)
  const result = f.run(0o022)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assertPrivateSummary(f)
  assert.equal(permissions(f.output) & 0o077, 0, 'private M4 output must deny all group/other read/write/execute bits')
})

test('expected RED: existing mode-0644 target is rejected unchanged or atomically replaced with mode-0600', (t) => {
  const f = fixture(t)
  const existingBytes = 'fictional placeholder, not a real participant report\n'
  writeFileSync(f.output, existingBytes, { mode: 0o644 })
  chmodSync(f.output, 0o644)
  const result = f.run(0o022)
  assert.equal(result.stdout, '')
  if (result.status !== 0) {
    assert.equal(readFileSync(f.output, 'utf8'), existingBytes, 'failed publication must preserve prior bytes')
    return
  }
  assertPrivateSummary(f)
  assert.equal(permissions(f.output) & 0o077, 0, 'overwriting a permissive target must not expose private report bytes')
})
