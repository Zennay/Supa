import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { readableObservationIssue } from '../src/features/observation/observationReadinessCopy.ts'

test('real empty M3 field pack keeps every required check but gives Dutch instructions', () => {
  const sheet = buildObservationSheet()
  const before = structuredClone(sheet)
  const gate = observationSheetReadiness(sheet)
  const display = gate.issues.map(readableObservationIssue)
  assert.equal(gate.ready, false)
  assert.equal(display.length, gate.issues.length)
  for (const copy of ['Metingcode ontbreekt.', 'Anonieme deelnemerscode ontbreekt.',
    'Startdatum van de meetweek ontbreekt.', 'Doelgroep ontbreekt.',
    'Gebied ontbreekt.', 'Manier van prijsmeten ontbreekt.']) {
    assert.ok(display.includes(copy), copy)
  }
  assert.ok(display.some(copy => copy.startsWith('PLUS:')))
  assert.ok(display.some(copy => copy.startsWith('DekaMarkt:')))
  assert.doesNotMatch(display.join('\n'), /Study ID|Participant key|Winkel A|Winkel B|evidence ID|provenance-notitie/)
  assert.deepEqual(sheet, before)
})

test('24-hour and missing price checks are never suppressed or promoted to evidence', () => {
  const texts = [
    'Winkel A: evidence ID ontbreekt.',
    'Winkel B: provenance-notitie ontbreekt.',
    'Winkel A en Winkel B moeten verschillende winkel-ID\'s hebben.',
    'De twee observaties liggen 25.0 uur uit elkaar; maximaal 24 uur is toegestaan.',
    'Winkel B · Basmati rijst: prijs per verpakking ontbreekt of is ongeldig.',
  ]
  const result = texts.map(readableObservationIssue)
  assert.equal(result.length, texts.length)
  assert.match(result[0], /PLUS: code van de winkelmeting ontbreekt/)
  assert.match(result[1], /DekaMarkt: toelichting op de prijsbron ontbreekt/)
  assert.match(result[2], /PLUS en DekaMarkt.*verschillende winkel-ID/)
  assert.equal(result[3], texts[3])
  assert.match(result[4], /DekaMarkt · Basmati rijst: prijs per verpakking ontbreekt/)
})

test('real routed Meten renders readable issues without changing original readiness', () => {
  const source = readFileSync(new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
  assert.match(source, /observationSheetReadiness\(sheet, Date\.now\(\)\)/)
  assert.match(source, /readableObservationIssue\(issue\)/)
  assert.match(source, /<ObservationNextActionCard action=\{nextAction\} \/>/)
  assert.doesNotMatch(source, /issues\.filter\(/)
})
