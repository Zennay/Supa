import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const card = await readFile(new URL('../docs/M3_FIELD_OPERATOR_CARD.md', import.meta.url), 'utf8')
const demand = [
  ['Kippendij', '600 g'],
  ['Basmati rijst', '450 g'],
  ['Kokosmelk', '400 ml'],
  ['Bloemkool', '2 stuks'],
  ['Garam masala', '20 g'],
  ['Broccoli', '250 g'],
  ['Edamame', '150 g'],
  ['Teriyaki saus', '60 ml'],
  ['Spaghetti', '250 g'],
  ['Tomatenblokjes', '400 g'],
  ['Griekse yoghurt', '100 g'],
]

test('operator card preserves exactly the canonical 11 M3 demand rows for both stores', () => {
  const table = card.split('## Same demand at BOTH stores')[1]?.split('For **each store')[0]
  assert.ok(table, 'canonical M3 field-run table is missing')
  const rows = table.split('\n').filter((line) => /^\| [^|-]+ \|/.test(line))
  assert.equal(rows.length, 11, 'collector must observe each of 11 requirements exactly once')
  const entries = rows.map((line) => line.split('|').slice(1, 3).map((item) => item.trim()))
  assert.deepEqual(entries, demand, 'M3 demand changed; update issue #78 and canonical protocol intentionally')
})

test('operator card retains real-observation and no-invented-savings boundaries', () => {
  for (const marker of ['current `main` commit SHA', 'priceContext', 'PLUS', 'DekaMarkt', 'within 24 hours',
    'participantKey', 'observedAt', 'evidenceId', 'source', 'priceCents', 'packCount', 'provenanceNote',
    'm3:build-observed-study', 'm3:assess-observed-week', 'better', 'same', 'worse', 'unknown',
    'not a savings advertisement', 'never manufacture', 'permission-gated', 'issue #78']) {
    assert.ok(card.includes(marker), `missing required evidence safeguard: ${marker}`)
  }
})
