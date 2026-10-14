import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

const file = new URL('../src/features/observation/ObservationView.tsx', import.meta.url)
const source = readFileSync(file, 'utf8')

test('review jump targets existing keyboard-focusable validation messages', () => {
  assert.match(source, /data-observation-review-target/)
  assert.match(source, /tabIndex=\{-1\}/)
  assert.match(source, /nextAction\.stage === 'review'/)
  assert.match(source, /document\.querySelector<HTMLElement>\('\[data-observation-review-target\]'\)/)
  assert.match(source, /review\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(source, /Ga naar: controlepunten/)
})

test('export jump moves to explicit save control and does not initiate downloads', () => {
  assert.match(source, /canNavigateExport = nextAction\.stage === 'export' && readiness\.ready/)
  assert.match(source, /data-observation-export-target onClick=\{downloadDraft\}/)
  assert.match(source, /document\.querySelector<HTMLButtonElement>\('\[data-observation-export-target\]'\)/)
  assert.match(source, /exportButton\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(source, /Ga naar: JSON-concept bewaren/)
  assert.doesNotMatch(source, /exportButton\?\.click\(|downloadDraft\(\)/)
})

test('incomplete or unobserved M3 data cannot skip human evidence to export', () => {
  const sheet = buildObservationSheet()
  const before = structuredClone(sheet)
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.equal(observationNextAction(sheet).stage, 'study')
  sheet.study.studyId = 'test'
  assert.notEqual(observationNextAction(sheet).stage, 'export')
  assert.equal(before.study.studyId, '')
  assert.match(source, /const readiness = useMemo\(\(\) => observationSheetReadiness\(sheet, Date\.now\(\)\), \[sheet\]\)/)
  assert.match(source, /const downloadDraft = \(\) =>/)
  assert.doesNotMatch(source, /window\.location\s*=|window\.open\(/)
})
