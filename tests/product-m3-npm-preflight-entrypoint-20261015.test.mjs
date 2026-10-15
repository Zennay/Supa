import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
function npmPreflight(args) {
  return spawnSync('npm', ['--silent', 'run', 'm3:preflight-week', '--', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 256 * 1024,
  })
}

test('product: installed npm field preflight is a real safe three-state operator command', () => {
  const approved = npmPreflight([])
  assert.ifError(approved.error)
  assert.equal(approved.status, 0, approved.stderr)
  const approvedReport = JSON.parse(approved.stdout)
  assert.equal(approvedReport.matchesFixedWorksheetDemand, true)
  assert.equal(approvedReport.physicalStudyIngredientsPerStore, 11)
  assert.equal(approvedReport.evidenceStatus, 'preflight-only-not-an-observation')
  assert.equal(approvedReport.publicSavingsClaimEligible, false)
  assert.equal(approvedReport.retailerReusePermissionVerified, false)
  assert.equal(approvedReport.fieldObservationEvidenceCollected, false)

  const mismatch = npmPreflight(['--days', 'Ma,Do'])
  assert.ifError(mismatch.error)
  assert.equal(mismatch.status, 3, mismatch.stderr)
  const mismatchReport = JSON.parse(mismatch.stdout)
  assert.equal(mismatchReport.matchesFixedWorksheetDemand, false)
  assert.deepEqual(mismatchReport.missingDays, ['Di', 'Wo'])
  assert.equal(mismatchReport.publicSavingsClaimEligible, false)

  const invalid = npmPreflight(['--plan', 'Ma:<private-invalid-id>'])
  assert.ifError(invalid.error)
  assert.equal(invalid.status, 2, invalid.stderr)
  assert.equal(invalid.stdout, '')
  assert.equal(invalid.stderr.includes('private-invalid-id'), false)
})
