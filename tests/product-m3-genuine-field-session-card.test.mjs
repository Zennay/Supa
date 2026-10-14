import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildObservationSheet,
  M3_EXPECTED_RETAILERS,
} from '../src/domain/m3ObservationSheet.ts'

const cardPath = 'docs/M3_GENUINE_FIELD_SESSION_CARD.md'
const workflowPath = '.github/workflows/m3-observed-week-report.yml'

test('human M3 session card matches the actual 11-line canonical demand', async () => {
  const card = await readFile(cardPath, 'utf8')
  const sheet = buildObservationSheet()

  assert.equal(sheet.requirements.length, 11)
  assert.equal(sheet.selectedMealCount, 4)
  assert.equal(sheet.study.maxObservationWindowHours, 24)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')

  for (const requirement of sheet.requirements) {
    const line = `- [ ] \`${requirement.id}\` — ${requirement.label} — ${requirement.amount} ${requirement.unit}`
    assert.equal(card.includes(line), true, `missing or altered field demand: ${requirement.id}`)
  }

  assert.deepEqual(M3_EXPECTED_RETAILERS, { baseline: 'PLUS', candidate: 'DekaMarkt' })
  assert.match(card, /baseline = PLUS/)
  assert.match(card, /candidate = DekaMarkt/)
})

test('human M3 session card does not turn preparations into retailer or savings evidence', async () => {
  const card = await readFile(cardPath, 'utf8')
  for (const requiredText of [
    'nog niet gestart',
    '24 verstreken uren',
    'in-store',
    'online-order',
    'manual-cart',
    'receipt',
    'consented-export',
    'geen publieke besparingsclaim',
    'publicSavingsClaimEligible: false',
    'same',
    'worse',
    'unknown',
    'geen fictieve prijzen',
    'geen workflow forceren',
    'buiten Git',
  ]) {
    assert.equal(
      card.toLowerCase().includes(requiredText.toLowerCase()),
      true,
      `missing safety or evidence constraint in operator card: ${requiredText}`,
    )
  }
})

test('human M3 session card points to real commands and the single field-pack dispatch', async () => {
  const [card, pkg, workflow] = await Promise.all([
    readFile(cardPath, 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile(workflowPath, 'utf8'),
  ])

  for (const name of [
    'm3:create-observation-sheet',
    'm3:build-observed-study',
    'm3:assess-observed-week',
  ]) {
    assert.match(card, new RegExp(`npm run ${name}`))
    assert.equal(typeof pkg.scripts[name], 'string')
    assert.notEqual(pkg.scripts[name].trim(), '')
  }

  assert.equal(card.includes(workflowPath), true)
  assert.match(workflow, /^  workflow_dispatch:/m)
  assert.match(workflow, /name: supa-m3-field-run-pack/)
  assert.match(workflow, /retention-days: 7/)
  assert.match(card, /7 dagen/)
  assert.match(card, /run-URL, run-ID, exacte SHA/)
  assert.match(card, /daadwerkelijke veldstart/)
})
