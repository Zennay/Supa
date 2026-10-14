import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const base = new URL('../docs/', import.meta.url)
const canonical = await readFile(new URL('M3_OBSERVED_BASKET_STUDY.md', base), 'utf8')

test('canonical M3 source contract links actual field guidance without claiming savings proof', async () => {
  const paths = [
    'product/m3-field-operator-checklist.md',
    'M3_FIELD_VISIT_CARD.md',
    'product/m3-field-decision-record-template.md',
    'M3_FIELD_DISCREPANCY_TRIAGE.md',
  ]
  for (const path of paths) {
    assert.ok(canonical.includes('](' + path + ')'), 'Missing M3 field guide link: ' + path)
    const body = await readFile(new URL(path, base), 'utf8')
    assert.ok(body.length > 250, 'Linked field guide cannot be an empty stub')
  }
  assert.match(canonical, /PLUS/)
  assert.match(canonical, /DekaMarkt/)
  assert.match(canonical, /24 uur/)
  assert.match(canonical, /geen openbare algemene besparingsclaim/i)
  assert.match(canonical, /github\.com\/Zennay\/Supa\/issues\/78/)
})
