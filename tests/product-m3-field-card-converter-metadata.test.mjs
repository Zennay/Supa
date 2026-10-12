import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { buildObservationSheet, observationLineCollectionComplete } from '../src/domain/m3ObservationSheet.ts'
import { renderM3FieldVisitCard } from '../src/domain/m3FieldVisitCard.ts'

const root = resolve('scripts/m3-field-visit-card.mjs')
function count(text, needle) {
  return text.split(needle).length - 1
}
function section(text, name) {
  return text.split('## ' + name + ' — ')[1]?.split(/^## /m)[0] ?? ''
}

test('M3 visit card preserves every distinct converter-required study metadata slot', () => {
  const canonical = buildObservationSheet()
  const card = renderM3FieldVisitCard()
  for (const field of [
    'studyId', 'participantKey', 'population', 'region', 'weekStart',
    'priceContext', 'maxObservationWindowHours',
  ]) {
    assert.ok(Object.hasOwn(canonical.study, field), field + ' must be canonical')
  }
  for (const slot of [
    'Studie-ID: ____________________',
    'Pseudonieme deelnemercode (geen naam/e-mail): ____________________',
    'Doelgroep: ____________________',
    'Regio: ____________________',
    'Week start: ____________________',
    'Kies ÉÉN prijscontext voor beide winkels:',
  ]) assert.equal(count(card, slot), 1, slot)
  assert.match(card, /binnen maximaal 24 uur/)
  assert.doesNotMatch(card, /Doelgroep:\s*(student|Leiden)\b|Studie-ID:\s*m3-week-/)
})

test('each M3 retailer has separate store identity, unique evidence ID, provenance, source and timestamp', () => {
  const canonical = buildObservationSheet()
  assert.deepEqual(Object.keys(canonical.baseline.store), ['id', 'name'])
  for (const side of ['baseline', 'candidate']) {
    const observation = canonical[side]
    for (const property of ['evidenceId', 'observedAt', 'source', 'provenanceNote', 'store', 'lines']) {
      assert.ok(Object.hasOwn(observation, property), property)
    }
  }

  const card = renderM3FieldVisitCard()
  for (const name of ['PLUS', 'DekaMarkt']) {
    const block = section(card, name)
    assert.ok(block.length > 0, name + ' section missing')
    for (const slot of [
      'Winkelnaam (zoals waargenomen): ____________________',
      'Winkel-ID (zelfgekozen unieke code; geen klantnummer): ____________________',
      'Waargenomen op (datum, tijd en tijdzone): ____________________',
      'Bron: [ ] handmatige mand  [ ] kassabon  [ ] export met toestemming',
      'Bewijs-ID (uniek per meting, zonder persoonsgegevens): ____________________',
      'Herkomstnotitie (wat, waar en hoe gecontroleerd): ____________________',
    ]) assert.equal(count(block, slot), 1, name + ' needs distinct ' + slot)
  }
  assert.doesNotMatch(card, /Bewijs-ID \/ herkomstnotitie/)
  assert.equal(count(card, 'Winkel-ID ('), 2)
  assert.equal(count(card, 'Herkomstnotitie ('), 2)
})

test('every canonical ingredient row has separate availability, pack amount, multipack count and price slots', () => {
  const canonical = buildObservationSheet()
  const text = renderM3FieldVisitCard()
  assert.equal(canonical.requirements.length, 11)
  for (const side of ['baseline', 'candidate']) {
    assert.equal(canonical[side].lines.length, canonical.requirements.length)
    for (const line of canonical[side].lines) {
      assert.deepEqual(
        Object.keys(line.observedProduct),
        ['productId', 'productName', 'packAmount', 'packUnit', 'packCount', 'priceCents', 'available', 'sourceUrl', 'note'],
      )
    }
  }
  for (const slot of [
    'Verkrijgbaar: [ ] ja  [ ] nee  [ ] onbekend',
    'Gezien product + merk:',
    'Verpakkingsinhoud (hoeveelheid + g/kg/ml/l/stuk):',
    'Aantal stuks in verkooppakket (multipack; 1 bij enkelpak):',
    'Prijs per verpakking (EUR): ________',
  ]) assert.equal(count(text, slot), 22, slot)
  assert.match(text, /Bij nee\/onbekend: laat product, verpakking en prijs leeg/)
  assert.match(text, /GEEN bewijs/)
  assert.match(text, /geen naam\/e-mail/)
  assert.doesNotMatch(text, /\bEUR\s*[0-9]+[,.][0-9]{2}\b|@example\.|https?:\/\//)
})

test('single-store card keeps shared study metadata but never prints second store metadata', () => {
  for (const [side, included, excluded] of [
    ['baseline', 'PLUS', 'DekaMarkt'],
    ['candidate', 'DekaMarkt', 'PLUS'],
  ]) {
    const card = renderM3FieldVisitCard(side)
    assert.match(card, /Doelgroep: ____________________/)
    assert.ok(card.includes('## ' + included + ' —'))
    assert.ok(!card.includes('## ' + excluded + ' —'))
    assert.equal(count(card, 'Winkel-ID ('), 1)
    assert.equal(count(card, 'Herkomstnotitie ('), 1)
    assert.equal(count(card, 'Verkrijgbaar: [ ] ja'), 11)
  }
})

test('stdout-only blank M3 visit CLI never creates fake retailer evidence files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-product-m3-card-metadata-'))
  try {
    for (const [args, expected] of [
      [[], renderM3FieldVisitCard()],
      [['--store', 'plus'], renderM3FieldVisitCard('baseline')],
      [['--store', 'dekamarkt'], renderM3FieldVisitCard('candidate')],
    ]) {
      const child = spawnSync(process.execPath, ['--experimental-strip-types', root, ...args], {
        cwd: dir, encoding: 'utf8',
      })
      assert.equal(child.status, 0, child.stderr)
      assert.equal(child.stderr, '')
      assert.equal(child.stdout, expected)
    }
    const invalid = spawnSync(process.execPath, [
      '--experimental-strip-types', root, '--output', 'fake-evidence.json',
    ], { cwd: dir, encoding: 'utf8' })
    assert.equal(invalid.status, 1)
    assert.equal(invalid.stdout, '')
    assert.deepEqual(await readdir(dir), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('unmeasured availability is never silently treated as confirmed unavailable', () => {
  const sheet = buildObservationSheet()
  const line = sheet.baseline.lines[0]
  assert.equal(line.observedProduct.available, null)
  assert.equal(observationLineCollectionComplete(line), false)

  const card = renderM3FieldVisitCard()
  assert.match(card, /Onbekend is niet hetzelfde als nee:/)
  assert.match(card, /ongemeten regel is nog niet klaar voor conversie/)

  // Explicit observed unavailability is collection-complete even without
  // a product or price, while a blank observation is not.
  line.observedProduct.available = false
  assert.equal(observationLineCollectionComplete(line), true)
  assert.equal(line.observedProduct.priceCents, null)
})
