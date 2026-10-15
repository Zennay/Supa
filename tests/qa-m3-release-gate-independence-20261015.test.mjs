import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent release-gate cross-check: a structural M1 license *fixture*
// is never authentic M3 human evidence. These cases run the actual rehearsal
// CLI in a disposable cwd and never contact a supermarket.
const REHEARSAL = fileURLToPath(new URL('../scripts/m3-rehearse-field-run.mjs', import.meta.url))
const GATE = fileURLToPath(new URL('../scripts/m1-check-source-permission-gate.mjs', import.meta.url))
const permission = {
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-04',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket,
    technicalStatus: 'proven',
    permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.invalid/THIS-IS-A-FICTIONAL-TEST',
      finding: 'Pure test fixture, NOT actual supermarket consent.',
    }],
  })),
}

function run(script, args, cwd, env = {}) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  })
  assert.equal(child.error, undefined, child.error?.message)
  return child
}

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-m3-independent-gates-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function assertNoM3Promotion(stdout) {
  const summary = JSON.parse(stdout)
  assert.equal(summary.kind, 'm3-field-pipeline-rehearsal')
  assert.equal(summary.syntheticOnly, true)
  assert.equal(summary.requirementPairsChecked, 11)
  assert.equal(summary.realRetailerEvidenceVerified, false)
  assert.equal(summary.m3ExitProven, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.m4BetaEligible, false)
  assert.deepEqual(summary.fictionalOutcomesVerified, ['better', 'same', 'worse', 'unknown'])
  assert.equal(/THIS-IS-A-FICTIONAL-TEST|\u20ac|\b1100\b|savingsCents|participantKey/.test(stdout), false)
}

test('M3 synthetic CLI remains a private rehearsal and writes no human evidence', async t => {
  const dir = await setup(t)
  const runResult = run(REHEARSAL, [], dir)
  assert.equal(runResult.status, 0, runResult.stderr)
  assert.equal(runResult.stderr, '')
  assertNoM3Promotion(runResult.stdout)
  assert.deepEqual(await readdir(dir), [])
})

test('M3 cannot treat a fictional two-store M1 authorization file as a verified 11+11 human field observation', async t => {
  const dir = await setup(t)
  const path = join(dir, 'fictional-permission.json')
  await writeFile(path, JSON.stringify(permission), { mode: 0o600 })
  const env = { SUPA_SOURCE_PERMISSION_GATE: path }

  // Positive control: the structurally valid *fictional* permission record
  // is accepted by the permission CLI. This is NOT real world authorization.
  const rights = run(GATE, ['--require-production-ready'], dir, env)
  assert.equal(rights.status, 0, rights.stderr)
  assert.equal(JSON.parse(rights.stdout).productionReady, true)

  const ordinary = run(REHEARSAL, [], dir)
  const withFictionalRights = run(REHEARSAL, [], dir, env)
  assert.equal(withFictionalRights.status, 0, withFictionalRights.stderr)
  assert.equal(withFictionalRights.stderr, '')
  assert.equal(withFictionalRights.stdout, ordinary.stdout)
  assertNoM3Promotion(withFictionalRights.stdout)
  assert.deepEqual(await readdir(dir), ['fictional-permission.json'])
})

test('M3 synthetic CLI rejects additional paths/flags without writing or echoing private filenames', async t => {
  const dir = await setup(t)
  const secret = 'DO-NOT-ECHO-PRIVATE-FIELD-EVIDENCE.json'
  const result = run(REHEARSAL, [secret], dir)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.includes(secret), false)
  assert.match(result.stderr, /^M3 synthetic rehearsal failed; no field evidence was processed\.\n$/)
  assert.deepEqual(await readdir(dir), [])
})
