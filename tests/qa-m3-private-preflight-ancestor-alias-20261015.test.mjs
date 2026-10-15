import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'

// Synthetic-only trusted-local-file proof: no retailer traffic or human data.
// The private readiness CLI already blocks static ancestor directory aliases;
// this QA checks whether the separate preflight CLI has the same boundary.
const SHA = '1234567890abcdef1234567890abcdef12345678'
const base = buildObservationSheet()
function observed(side, time) {
  return {
    evidenceId: 'fictional-' + side,
    observedAt: time,
    source: 'manual-cart',
    provenanceNote: 'simulated local input, not retailer verification',
    basket: {
      store: side === 'baseline'
        ? { id: 'plus-fictional', name: 'PLUS' }
        : { id: 'deka-fictional', name: 'DekaMarkt' },
      selectedMealCount: base.selectedMealCount,
      lines: base.requirements.map(row => ({
        id: row.id,
        ingredientLabel: row.label,
        requirement: { amount: row.amount, unit: row.unit },
        status: 'unresolved',
        reasons: ['fictional unknown product'],
        matchScore: null,
      })),
      totalCents: 0,
      matchedLineCount: 0,
      unresolvedLineCount: base.requirements.length,
    },
  }
}
function study() {
  return {
    schemaVersion: 1,
    studyId: 'fictional-alias-qa',
    participantKey: 'fictional-key',
    population: 'fictional students',
    region: 'fictional region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
    baseline: observed('baseline', '2026-10-14T11:00:00Z'),
    candidate: observed('candidate', '2026-10-14T12:00:00Z'),
  }
}
async function withPrivateFiles(callback) {
  const temp = await mkdtemp(join(tmpdir(), 'supa-m3-preflight-ancestor-'))
  try {
    const actual = join(temp, 'actual')
    const alias = join(temp, 'aliased-ancestor')
    await mkdir(actual, { mode: 0o700 })
    const source = Buffer.from(JSON.stringify(study()))
    const manifest = Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(source, SHA)))
    await writeFile(join(actual, 'study.json'), source, { mode: 0o600 })
    await writeFile(join(actual, 'pin.json'), manifest, { mode: 0o600 })
    await symlink(actual, alias, 'dir')
    await callback({ actual, alias, temp })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
function run(studyPath, pinPath) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types',
    'scripts/m3-verify-private-week-preflight.mjs',
    studyPath, pinPath, '--expect-main-sha', SHA,
  ], { encoding: 'utf8', timeout: 8000 })
}
function assertDenied(result) {
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.status, 1,
    'unsafe input must be refused, not privately admitted')
  assert.equal(result.stdout, '',
    'preflight must not print private result for unsafe sources')
  assert.equal(result.stderr.trim(), 'M3 private study provenance preflight refused')
  assert.doesNotMatch(result.stderr, /aliased-ancestor|study\.json|pin\.json|fictional/)
}

test('M3 study preflight accepts regular fictional 11x11 files only for private review', async () => {
  await withPrivateFiles(async ({ actual }) => {
    const result = run(join(actual, 'study.json'), join(actual, 'pin.json'))
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const review = JSON.parse(result.stdout)
    assert.equal(review.status, 'private-review-only')
    assert.equal(review.sameDemandLineCount, 11)
    for (const key of [
      'sourceCommitShaAuthenticated', 'codeRevisionVerified',
      'retailerPermissionVerified', 'publicSavingsClaimEligible',
    ]) assert.equal(review[key], false, key)
    assert.doesNotMatch(result.stdout, /fictional|participant|simulated|priceCents/)
  })
})

test('M3 private preflight already rejects final component symlink for study', async () => {
  await withPrivateFiles(async ({ actual, temp }) => {
    const linked = join(temp, 'linked-study.json')
    await symlink(join(actual, 'study.json'), linked)
    assertDenied(run(linked, join(actual, 'pin.json')))
  })
})

test('M3 private preflight must reject a symlinked ancestor of the study', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only O_NOFOLLOW QA')
  await withPrivateFiles(async ({ actual, alias }) => {
    assertDenied(run(join(alias, 'study.json'), join(actual, 'pin.json')))
  })
})

test('M3 private preflight must reject a symlinked ancestor of the code-pin manifest', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only O_NOFOLLOW QA')
  await withPrivateFiles(async ({ actual, alias }) => {
    assertDenied(run(join(actual, 'study.json'), join(alias, 'pin.json')))
  })
})
