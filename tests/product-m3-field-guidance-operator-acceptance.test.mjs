import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildObservationSheet,
  M3_EXPECTED_RETAILERS,
} from '../src/domain/m3ObservationSheet.ts'
import { observationRetailerCopy } from '../src/features/observation/observationPresentation.ts'

test('M3 operator copy preserves one shared 11-line baseline/candidate demand', () => {
  const sheet = buildObservationSheet()
  assert.equal(sheet.requirements.length, 11)
  assert.deepEqual(
    sheet.baseline.lines.map(({ ingredientId, requirement }) => [ingredientId, requirement]),
    sheet.candidate.lines.map(({ ingredientId, requirement }) => [ingredientId, requirement]),
  )
  const first = observationRetailerCopy('baseline')
  const second = observationRetailerCopy('candidate')
  assert.equal(first.expectedRetailer, M3_EXPECTED_RETAILERS.baseline)
  assert.equal(second.expectedRetailer, M3_EXPECTED_RETAILERS.candidate)
  assert.match(first.guidance, /dezelfde ingrediënten en hoeveelheden/)
  assert.match(second.guidance, /precies dezelfde ingrediënten en hoeveelheden/)
  assert.match(second.guidance, /binnen 24 uur van de eerste meting/)
  assert.match(second.guidance, /dezelfde regio en prijscontext/)
  assert.match(first.guidance, /één regio en één prijscontext/)
  assert.notEqual(first.guidance, second.guidance)
})

test('M3 operator guidance never treats unknown/unobserved as unavailable or fabricates prices', () => {
  for (const side of ['baseline', 'candidate']) {
    const copy = observationRetailerCopy(side)
    assert.match(copy.guidance, /echt[e]? meetmoment met tijdzone/)
    assert.match(copy.guidance, /Onbekend is niet hetzelfde als niet beschikbaar/)
    assert.match(copy.guidance, /gok geen product of prijs/)
    assert.match(copy.guidance, /feitelijke beschikbaarheid|feitelijke beschikbaarheid/i)
    assert.doesNotMatch(copy.guidance, /€\s*\d|EUR\s*\d|[0-9]+[,.][0-9]{2}\s*euro/)
    assert.doesNotMatch(copy.guidance, /besparing bewezen|klaar voor M4|actuele supermarktprijzen/)
  }
})

test('real Meten view routes field guidance under the correct store, without modifying canonical source', () => {
  const source = readFileSync(new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
  assert.match(source, /const retailerCopy = observationRetailerCopy\(side\)/)
  assert.match(source, /\{retailerCopy\.guidance\}/)
  assert.match(source, /\['baseline', 'candidate'\]/)
  // Guidance is presentation only: all actual gates still call real readiness,
  // and each observation remains local and unverified until human assessment.
  assert.match(source, /observationSheetReadiness\(sheet, referenceNowMs\)/)
  assert.match(source, /window\.setInterval\(refresh, 60_000\)/)
})
