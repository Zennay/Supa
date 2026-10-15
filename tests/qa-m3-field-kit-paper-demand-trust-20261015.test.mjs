import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'

import { buildM3FieldKit } from '../scripts/m3-prepare-field-kit.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { observationSheetReadiness, buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

// Checks physical paper, digital collector and companion revision together.
// No retailer HTTP, actual price observations, people, or public claims.
const FAKE_SHA = 'e'.repeat(40)
function documents() {
  const kit = buildM3FieldKit({ branch: 'main', sha: FAKE_SHA })
  return {
    sheet: JSON.parse(kit['collection-sheet.json']),
    revision: JSON.parse(kit['source-revision.json']),
    paper: kit['field-form.html'],
  }
}
function escapeHtml(input) {
  return String(input).replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char])
}

test('paper forms exactly mirror each of both digital 11-line baskets in row order and units', () => {
  const { sheet, paper } = documents()
  assert.deepEqual(sheet, buildObservationSheet())
  assert.match(paper, /data-m3-side="baseline"/u)
  assert.match(paper, /data-m3-side="candidate"/u)
  assert.match(paper, /PLUS — dezelfde 11 boodschappen/u)
  assert.match(paper, /DekaMarkt — dezelfde 11 boodschappen/u)
  const rows = [...paper.matchAll(/<tr data-m3-row="([0-9]+)"><td><strong>([^<]+)<\/strong><small>Benodigd: ([^<]+)<\/small>/gu)]
  assert.equal(rows.length, 22)
  for (const [sideIndex, side] of ['baseline', 'candidate'].entries()) {
    const actual = rows.slice(sideIndex * 11, (sideIndex + 1) * 11)
    assert.equal(actual.length, 11)
    for (const [index, requirement] of sheet.requirements.entries()) {
      const [whole, position, label, demand] = actual[index]
      const unit = requirement.unit === 'piece'
        ? (requirement.amount === 1 ? 'stuk' : 'stuks') : requirement.unit
      assert.equal(position, String(index + 1), side + ' form row mismatch')
      assert.equal(label, String(index + 1) + '. ' + escapeHtml(requirement.label))
      assert.equal(demand, escapeHtml(requirement.amount + ' ' + unit))
      assert.equal(sheet[side].lines[index].ingredientId, requirement.id)
      assert.equal(sheet[side].lines[index].requirement.amount, requirement.amount)
      assert.equal(sheet[side].lines[index].requirement.unit, requirement.unit)
      assert.ok(whole.length > 0)
    }
  }
})

test('companion hash independently authenticates unchanged digital demand, not imagined source prices', () => {
  const { sheet, revision } = documents()
  const expected = createHash('sha256').update(JSON.stringify(sheet.requirements)).digest('hex')
  assert.equal(revision.canonicalDemandSha256, expected)
  assert.equal(revision.sourceCommitSha, FAKE_SHA)
  assert.equal(revision.sourceBranch, 'main')
  assert.equal(revision.requiredLinesPerRetailer, 11)
  assert.equal(revision.baselineRetailer, 'PLUS')
  assert.equal(revision.candidateRetailer, 'DekaMarkt')
  assert.equal(revision.publicSavingsClaimEligible, false)
  assert.equal(revision.verifiedRetailerObservations, false)
  assert.equal(Object.hasOwn(sheet.study, 'sourceCommitSha'), false,
    'Source commit pin still lives only in companion revision file; #205 remains open')
})

test('the wholly blank field kit cannot be exported as a completed weekly money study', () => {
  const { sheet, revision } = documents()
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  const before = JSON.stringify(sheet)
  const readiness = observationSheetReadiness(sheet)
  assert.equal(readiness.ready, false)
  assert.ok(readiness.issues.length > 0)
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet))
  assert.equal(revision.verifiedRetailerObservations, false)
  assert.equal(revision.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(sheet), before)
})
