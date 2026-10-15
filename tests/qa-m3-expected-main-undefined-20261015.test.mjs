import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week, main } from '../scripts/m3-verify-private-week-preflight.mjs'

// QA-only: synthetic M3 metadata, no genuine store prices, participant or rights.
const MAIN = 'abcdef1234567890abcdef1234567890abcdef12'
const expected = buildObservationSheet()
const rows = () => expected.requirements.map((r) => ({
  id: r.id, ingredientLabel: r.label,
  requirement: { amount: r.amount, unit: r.unit },
  status: 'unresolved', reasons: ['fictional price unknown'], matchScore: null,
}))
function observed(side, when) {
  return {
    evidenceId: 'synthetic-' + side, observedAt: when,
    source: 'manual-cart', provenanceNote: 'all invented',
    basket: {
      store: side === 'baseline'
        ? { id: 'plus-local', name: 'PLUS' }
        : { id: 'deka-local', name: 'DekaMarkt' },
      selectedMealCount: expected.selectedMealCount,
      lines: rows(), totalCents: 0, matchedLineCount: 0,
      unresolvedLineCount: expected.requirements.length,
    },
  }
}
function fixture() {
  const study = Buffer.from(JSON.stringify({
    schemaVersion: 1, studyId: 'fictional-qa-only',
    participantKey: 'fictional-private-marker-qa', population: 'invented',
    region: 'fictional', weekStart: '2026-10-12', priceContext: 'in-store',
    baseline: observed('baseline', '2026-10-14T11:00:00Z'),
    candidate: observed('candidate', '2026-10-14T12:00:00Z'),
  }))
  const manifest = Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(study, MAIN)))
  return { study, manifest }
}

test('omitting expected SHA intentionally retains legacy private behavior without public claims', () => {
  const { study, manifest } = fixture()
  const result = preflightPrivateM3Week(study, manifest)
  assert.equal(result.privateStudyBytesMatch, true)
  assert.equal(result.sourceCommitShaAuthenticated, false)
  assert.equal(result.codeRevisionVerified, false)
  assert.equal(result.retailerPermissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('an explicitly supplied undefined expected SHA cannot downgrade a required integrity check', () => {
  const { study, manifest } = fixture()
  // An orchestrator may pass an unset optional value for a mandatory check.
  // Unlike an omitted third argument, explicitly providing undefined must
  // not silently fall back to the legacy no-revision-check mode.
  assert.throws(
    () => preflightPrivateM3Week(study, manifest, undefined),
    /M3 private study provenance preflight refused/,
  )
})

test('exported main refuses an explicit undefined --expect-main-sha value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-expect-sha-'))
  const priorWrite = process.stdout.write
  let stdout = ''
  try {
    const { study, manifest } = fixture()
    const source = join(dir, 'private-study.json')
    const pin = join(dir, 'private-pin.json')
    await writeFile(source, study, { mode: 0o600 })
    await writeFile(pin, manifest, { mode: 0o600 })
    process.stdout.write = function (chunk) {
      stdout += String(chunk)
      return true
    }
    await assert.rejects(
      main([source, pin, '--expect-main-sha', undefined]),
      /M3 private study provenance preflight refused/,
    )
    assert.equal(stdout, '', 'a refused private check must not print any study details or false approval')
  } finally {
    process.stdout.write = priorWrite
    await rm(dir, { recursive: true, force: true })
  }
})

test('a defined matching expected SHA remains an offline private-only comparison', () => {
  const { study, manifest } = fixture()
  const result = preflightPrivateM3Week(study, manifest, MAIN)
  assert.equal(result.privateStudyBytesMatch, true)
  assert.equal(result.sourceCommitSha, MAIN)
  assert.equal(result.sourceCommitShaAuthenticated, false)
  assert.equal(result.codeRevisionVerified, false)
  assert.equal(result.retailerPermissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.throws(() => preflightPrivateM3Week(study, manifest, 'f'.repeat(40)), /preflight refused/)
})
