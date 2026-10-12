import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { renderM3FieldVisitCard } from '../src/domain/m3FieldVisitCard.ts'

// Replayed on frozen product metadata repair #2056; independent QA #2053 remains untouched.
const SCRIPT = resolve('scripts/m3-field-visit-card.mjs')
const rowPattern = /^\d+\. .+ — nodig: .+$/

function rows(text) {
  return text.split('\n').filter((line) => rowPattern.test(line))
}

function expectedDemandRows() {
  return buildObservationSheet().requirements.map((item, index) => {
    const number = String(item.amount).replace('.', ',')
    const unit =
      item.unit === 'piece'
        ? item.amount === 1 ? 'stuk' : 'stuks'
        : item.unit
    return `${index + 1}. ${item.label} — nodig: ${number} ${unit}`
  })
}

function runCard(args, cwd) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', SCRIPT, ...args],
    { cwd, encoding: 'utf8' },
  )
}

test('independent M3 card oracle preserves every canonical quantity AND unit, in both store orders', () => {
  const expected = expectedDemandRows()
  const original = buildObservationSheet()
  assert.equal(original.requirements.length, 11)
  assert.equal(original.baseline.lines.length, expected.length)
  assert.equal(original.candidate.lines.length, expected.length)

  const card = renderM3FieldVisitCard()
  const blocks = card.split(/^## /m)
  assert.equal(blocks.length, 3, 'exactly two retailer sections')
  assert.ok(blocks[1].startsWith('PLUS — eerste winkel\n'))
  assert.ok(blocks[2].startsWith('DekaMarkt — vergelijkwinkel\n'))
  assert.deepEqual(rows(blocks[1]), expected, 'PLUS must carry the exact demand')
  assert.deepEqual(rows(blocks[2]), expected, 'DekaMarkt must carry the exact demand')
  assert.deepEqual(rows(card), expected.concat(expected), 'no dropped, duplicated, or swapped rows')

  for (const item of original.requirements) {
    assert.ok(['g', 'kg', 'ml', 'l', 'piece'].includes(item.unit))
  }
})

test('M3 field card remains a blank worksheet instead of counterfeit observation evidence', () => {
  const card = renderM3FieldVisitCard()
  assert.match(card, /GEEN bewijs/)
  assert.match(card, /officiële M3 JSON-observatie/)
  assert.match(card, /binnen maximaal 24 uur/)
  assert.match(card, /Kies ÉÉN prijscontext voor beide winkels/)
  assert.match(card, /Studie-ID: ____________________/)
  assert.match(card, /Pseudonieme deelnemercode \(geen naam\/e-mail\): ____________________/)

  assert.equal((card.match(/Waargenomen op \(datum, tijd en tijdzone\): ____________________/g) ?? []).length, 2)
  assert.equal((card.match(/Filiaal of bestelcontext: ____________________/g) ?? []).length, 2)
  assert.equal((card.match(/Verkrijgbaar: \[ \] ja  \[ \] nee  \[ \] onbekend/g) ?? []).length, 22)
  assert.equal((card.match(/Prijs per verpakking \(EUR\): ________/g) ?? []).length, 22)
  // Converter-aligned correction: evidenceId and provenanceNote must be separate
  // source fields for each retailer, never an ambiguous combined paper slot.
  for (const slot of [
    'Winkelnaam (zoals waargenomen): ____________________',
    'Winkel-ID (zelfgekozen unieke code; geen klantnummer): ____________________',
    'Bewijs-ID (uniek per meting, zonder persoonsgegevens): ____________________',
    'Herkomstnotitie (wat, waar en hoe gecontroleerd): ____________________',
  ]) {
    assert.equal(card.split(slot).length - 1, 2, slot)
  }
  assert.equal(card.split('Doelgroep: ____________________').length - 1, 1)
  assert.equal(card.split('Verpakkingsinhoud (hoeveelheid + g/kg/ml/l/stuk):').length - 1, 22)
  assert.equal(card.split('Aantal stuks in verkooppakket (multipack; 1 bij enkelpak):').length - 1, 22)
  assert.doesNotMatch(card, /Bewijs-ID \/ herkomstnotitie/)
  assert.doesNotMatch(card, /https?:\/\/|@example\.|\bEUR\s*\d+[,.]\d{2}\b/)
  assert.doesNotMatch(card, /publicSavingsClaimEligible\s*:\s*true/)
})

test('M3 one-store CLI selection agrees with the independent complete demand oracle', () => {
  const demand = expectedDemandRows()
  for (const [flag, side, excluded] of [
    ['plus', 'baseline', '## DekaMarkt'],
    ['dekamarkt', 'candidate', '## PLUS'],
  ]) {
    const selected = renderM3FieldVisitCard(side)
    assert.deepEqual(rows(selected), demand)
    assert.ok(!selected.includes(excluded))
    const child = runCard(['--store', flag], process.cwd())
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stderr, '')
    assert.equal(child.stdout, selected)
  }
})

test('M3 card CLI stdout is repeatable, rejects unsafe args and creates no files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-m3-card-'))
  try {
    const normal = runCard([], dir)
    const repeated = runCard(['--store', 'both'], dir)
    assert.equal(normal.status, 0, normal.stderr)
    assert.equal(repeated.status, 0, repeated.stderr)
    assert.equal(normal.stderr, '')
    assert.equal(repeated.stderr, '')
    assert.equal(normal.stdout, repeated.stdout)
    assert.equal(normal.stdout, renderM3FieldVisitCard())

    for (const args of [
      ['--store'],
      ['--store', 'PLUS'],
      ['--store', '../plus'],
      ['--output', 'private-evidence.json'],
      ['--store', 'both', '--output', 'private-evidence.json'],
    ]) {
      const rejected = runCard(args, dir)
      assert.equal(rejected.status, 1, `should reject ${args.join(' ')}`)
      assert.equal(rejected.stdout, '')
      assert.match(rejected.stderr, /^gebruik: node --experimental-strip-types scripts\/m3-field-visit-card\.mjs/)
      assert.doesNotMatch(rejected.stderr, /private-evidence\.json/)
    }
    assert.deepEqual(await readdir(dir), [], 'the card never produces saved evidence')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
