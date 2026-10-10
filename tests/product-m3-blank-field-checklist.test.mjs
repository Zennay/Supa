import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  buildBlankM3FieldChecklistCsv,
  csvCell,
} from '../scripts/m3-export-blank-field-checklist.mjs'
import {
  buildObservationSheet,
  M3_EXPECTED_RETAILERS,
} from '../src/domain/m3ObservationSheet.ts'

const columns = [
  'retailer_role', 'retailer', 'ingredient_id', 'ingredient_label',
  'search_query', 'required_amount', 'required_unit', 'observed_at',
  'price_context', 'product_name', 'pack_amount', 'pack_unit',
  'pack_count', 'price_cents', 'available', 'source', 'source_url',
  'note', 'evidence_status',
]
const blankColumns = [
  'observed_at', 'price_context', 'product_name', 'pack_amount',
  'pack_unit', 'pack_count', 'price_cents', 'available', 'source',
  'source_url', 'note',
]

function parseRow(line) {
  const cells = line.match(/"(?:[^"]|"")*"(?:,|$)/g)
  assert.ok(cells, 'CSV uses quoted fields')
  return cells.map(cell => {
    const token = cell.endsWith(',') ? cell.slice(0, -1) : cell
    return token.slice(1, -1).replaceAll('""', '"')
  })
}

test('blank field CSV follows canonical 11 demands for BOTH retailer roles (22 slots)', () => {
  const sheet = buildObservationSheet()
  const output = buildBlankM3FieldChecklistCsv()
  const lines = output.trimEnd().split('\n')
  assert.equal(lines.length, 23)
  assert.deepEqual(parseRow(lines[0]), columns)
  assert.equal(sheet.selectedMealCount, 4)
  for (const [roleIndex, role] of ['baseline', 'candidate'].entries()) {
    for (let index = 0; index < sheet.requirements.length; index++) {
      const row = Object.fromEntries(columns.map((name, i) => [
        name, parseRow(lines[1 + roleIndex * 11 + index])[i],
      ]))
      const requirement = sheet.requirements[index]
      assert.equal(row.retailer_role, role)
      assert.equal(row.retailer, M3_EXPECTED_RETAILERS[role])
      assert.equal(row.ingredient_id, requirement.id)
      assert.equal(row.ingredient_label, requirement.label)
      assert.equal(row.search_query, requirement.query)
      assert.equal(row.required_amount, String(requirement.amount))
      assert.equal(row.required_unit, requirement.unit)
      assert.equal(row.evidence_status, 'collection-template-not-evidence')
      for (const field of blankColumns) assert.equal(row[field], '', field)
    }
  }
})

test('all eleven IDs are unique per retailer and both sides have identical demand fingerprints', () => {
  const rows = buildBlankM3FieldChecklistCsv().trimEnd().split('\n').slice(1)
  const signatures = rows.map(line => {
    const row = Object.fromEntries(columns.map((name, i) => [name, parseRow(line)[i]]))
    return [row.ingredient_id, row.ingredient_label, row.search_query,
      row.required_amount, row.required_unit].join('|')
  })
  const plus = signatures.slice(0, 11)
  const deka = signatures.slice(11)
  assert.equal(new Set(plus).size, 11)
  assert.deepEqual(deka, plus)
  assert.ok(plus.every(signature => signature.split('|').every(Boolean)))
})

test('CSV export is deterministic and does not mark any price, participant or savings as collected', () => {
  const first = buildBlankM3FieldChecklistCsv()
  assert.equal(first, buildBlankM3FieldChecklistCsv())
  assert.doesNotMatch(first, /savingsCents|claimable|participantKey|studyId|@example\.com/i)
  for (const line of first.trimEnd().split('\n')) {
    assert.equal(parseRow(line).length, columns.length)
  }
})

test('CSV neutralizes formula prefixes, quotes valid text and rejects multiline/control cells', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"')
  assert.equal(csvCell(' +SUM(A1)'), '"\' +SUM(A1)"')
  assert.equal(csvCell('@user'), '"\'@user"')
  assert.equal(csvCell('safe "quoted"'), '"safe ""quoted"""')
  assert.equal(csvCell(null), '""')
  for (const input of ['line\nbreak', 'line\rbreak', 'bad\u0000cell']) {
    assert.throws(() => csvCell(input), /unsafe cell/)
  }
})

test('actual opt-in CLI writes exactly blank CSV to stdout and rejects unexpected args', () => {
  const script = 'scripts/m3-export-blank-field-checklist.mjs'
  const stdout = execFileSync(process.execPath, [
    '--experimental-strip-types', script,
  ], { encoding: 'utf8' })
  assert.equal(stdout, buildBlankM3FieldChecklistCsv())
  const bad = spawnSync(process.execPath, [
    '--experimental-strip-types', script, '--output', 'some-private-path',
  ], { encoding: 'utf8' })
  assert.notEqual(bad.status, 0)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /blank checklist export failed/)
  assert.doesNotMatch(bad.stderr, /some-private-path/)
})
