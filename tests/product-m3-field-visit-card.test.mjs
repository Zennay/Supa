import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { renderM3FieldVisitCard } from '../src/domain/m3FieldVisitCard.ts'

function rowLines(card) {
  return card.split('\n').filter((line) => /^\d+\. /.test(line))
}

test('M3 product field card derives both exact ordered canonical demand lists', () => {
  const original = buildObservationSheet()
  const card = renderM3FieldVisitCard()
  const rows = rowLines(card)

  assert.equal(rows.length, original.requirements.length * 2)
  assert.equal(original.requirements.length, 11)
  assert.deepEqual(rows.slice(0, 11), rows.slice(11))

  for (const [index, required] of original.requirements.entries()) {
    assert.match(rows[index], new RegExp(`^${index + 1}\\. `))
    assert.ok(rows[index].includes(required.label))
    assert.ok(rows[index].includes(String(required.amount).replace('.', ',')))
  }
  assert.equal((card.match(/## PLUS — eerste winkel/g) ?? []).length, 1)
  assert.equal((card.match(/## DekaMarkt — vergelijkwinkel/g) ?? []).length, 1)
  assert.match(card, /Bloemkool — nodig: 2 stuks/)
  assert.match(card, /binnen maximaal 24 uur/)
})

test('M3 one-store card never accidentally includes other store measurement fields', () => {
  const plus = renderM3FieldVisitCard('baseline')
  const deka = renderM3FieldVisitCard('candidate')
  const demandCount = buildObservationSheet().requirements.length
  assert.equal(rowLines(plus).length, demandCount)
  assert.equal(rowLines(deka).length, demandCount)
  assert.deepEqual(rowLines(plus), rowLines(deka))
  assert.match(plus, /## PLUS/)
  assert.doesNotMatch(plus, /## DekaMarkt/)
  assert.match(deka, /## DekaMarkt/)
  assert.doesNotMatch(deka, /## PLUS/)
  assert.throws(() => renderM3FieldVisitCard('another-store'), /unknown M3 field visit selection/)
})

test('M3 field card has explicit privacy and non-evidence boundaries', () => {
  const card = renderM3FieldVisitCard()
  assert.match(card, /GEEN bewijs/)
  assert.match(card, /officiële M3 JSON-observatie/)
  assert.match(card, /geen naam\/e-mail/)
  assert.match(card, /beschikbaarheid in op basis van een aanname/)
  assert.match(card, /hogere of onbekende kosten/)
  assert.doesNotMatch(card, /student-00\d|@example\.|https?:\/\//)
  assert.equal(card.includes('EUR 0,00'), false)
})

test('M3 CLI defaults to two stores and writes nothing to its working directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-card-'))
  try {
    const child = spawnSync(
      process.execPath,
      ['--experimental-strip-types', resolve('scripts/m3-field-visit-card.mjs')],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stdout, renderM3FieldVisitCard())
    assert.equal(child.stderr, '')
    assert.equal(existsSync(join(dir, 'observation-sheet.json')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 CLI handles one-store selection and rejects incorrect arguments', () => {
  const script = resolve('scripts/m3-field-visit-card.mjs')
  for (const [name, side] of [['plus', 'baseline'], ['dekamarkt', 'candidate']]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', script, '--store', name], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stdout, renderM3FieldVisitCard(side))
  }

  for (const args of [['--store', 'other'], ['--store'], ['--output', 'private.json'], ['extra']]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], { encoding: 'utf8' })
    assert.equal(child.status, 1)
    assert.equal(child.stdout, '')
    assert.match(child.stderr, /gebruik: node --experimental-strip-types scripts/m3-field-visit-card.mjs/)
  }
})
