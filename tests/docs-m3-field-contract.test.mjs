import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildObservationSheet, M3_EXPECTED_RETAILERS } from '../src/domain/m3ObservationSheet.ts'

const contractPath = 'docs/M3_OBSERVED_BASKET_STUDY.md'
const packagePath = 'package.json'
const workflowPath = '.github/workflows/m3-observed-week-report.yml'

const expectedM3Scripts = [
  'm3:create-observation-sheet',
  'm3:build-observed-study',
  'm3:assess-observed-week',
]

const canonicalM3Demand = [
  { id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst', amount: 450, unit: 'g' },
  { id: 'broccoli', label: 'Broccoli', query: 'broccoli', amount: 250, unit: 'g' },
  { id: 'cauliflower', label: 'Bloemkool', query: 'bloemkool', amount: 2, unit: 'piece' },
  { id: 'chicken-thigh', label: 'Kippendij', query: 'kippendij', amount: 600, unit: 'g' },
  { id: 'coconut-milk', label: 'Kokosmelk', query: 'kokosmelk', amount: 400, unit: 'ml' },
  { id: 'edamame', label: 'Edamame', query: 'edamame', amount: 150, unit: 'g' },
  { id: 'garam-masala', label: 'Garam masala', query: 'garam masala', amount: 20, unit: 'g' },
  { id: 'greek-yogurt', label: 'Griekse yoghurt', query: 'griekse yoghurt', amount: 100, unit: 'g' },
  { id: 'spaghetti', label: 'Spaghetti', query: 'spaghetti', amount: 250, unit: 'g' },
  { id: 'teriyaki-sauce', label: 'Teriyaki saus', query: 'teriyaki saus', amount: 60, unit: 'ml' },
  { id: 'tomato-cubes', label: 'Tomatenblokjes', query: 'tomatenblokjes', amount: 400, unit: 'g' },
]

test('M3 field contract keeps the canonical evidence-collection boundary explicit', async () => {
  const contract = await readFile(contractPath, 'utf8')

  for (const requiredText of [
    'current `main` revision',
    workflowPath,
    '**baseline = PLUS**',
    '**candidate = DekaMarkt**',
    'do not swap the retailers',
    'within the 24-hour study window',
    'same 11 ingredient requirements',
    '`collection-template-not-evidence`',
    'rejects blank or option-like `--output` values before any filesystem write',
    'A `worse` or `unknown` study still produces a valid report',
    '`publicSavingsClaimEligible: false`',
    'one explicitly recorded price context',
    '`in-store`',
    '`online-order`',
    'do not put names, email addresses or account IDs in versioned study fixtures',
  ]) {
    assert.equal(
      contract.toLowerCase().includes(requiredText.toLowerCase()),
      true,
      `missing canonical M3 field-contract text: ${requiredText}`,
    )
  }
})

test('documented M3 field commands stay executable through package scripts', async () => {
  const [contract, packageJson] = await Promise.all([
    readFile(contractPath, 'utf8'),
    readFile(packagePath, 'utf8').then(JSON.parse),
  ])

  const documentedM3Scripts = [
    ...contract.matchAll(/npm run (m3:[a-z0-9:-]+)/g),
  ].map((match) => match[1])

  assert.deepEqual(
    [...new Set(documentedM3Scripts)].sort(),
    [...expectedM3Scripts].sort(),
    'field contract must document exactly the supported M3 operational commands',
  )

  for (const script of expectedM3Scripts) {
    assert.equal(
      typeof packageJson.scripts?.[script],
      'string',
      `documented M3 command is missing from package.json: ${script}`,
    )
    assert.notEqual(
      packageJson.scripts[script].trim(),
      '',
      `documented M3 command has an empty package.json script: ${script}`,
    )
  }
})

test('documented M3 execution entrypoints remain backed by repository files', async () => {
  const [contract, packageJson, workflow] = await Promise.all([
    readFile(contractPath, 'utf8'),
    readFile(packagePath, 'utf8').then(JSON.parse),
    readFile(workflowPath, 'utf8'),
  ])

  assert.equal(
    contract.includes(workflowPath),
    true,
    'field contract must retain the canonical M3 workflow path',
  )
  assert.notEqual(workflow.trim(), '', 'canonical M3 workflow file must not be empty')

  for (const script of expectedM3Scripts) {
    const command = packageJson.scripts[script]
    const target = command.match(/\b(scripts\/[^\s]+\.mjs)\b/)?.[1]

    assert.ok(target, `M3 package script must point at a scripts/*.mjs entrypoint: ${script}`)

    const source = await readFile(target, 'utf8')
    assert.notEqual(source.trim(), '', `M3 script entrypoint must not be empty: ${target}`)
  }
})

test('M3 field command examples preserve artifact versus evidence storage boundaries', async () => {
  const contract = await readFile(contractPath, 'utf8')

  for (const command of [
    'npm run m3:create-observation-sheet -- --output artifacts/m3/observation-sheet.json',
    'npm run m3:build-observed-study -- artifacts/m3/observation-sheet.json --output evidence/m3/<study>.json',
    'npm run m3:assess-observed-week -- evidence/m3/<study>.json --output artifacts/m3/<study>-assessment.json',
  ]) {
    assert.equal(
      contract.includes(command),
      true,
      `missing canonical M3 field command example: ${command}`,
    )
  }
})

test('M3 field contract stays aligned with runtime study constants', async () => {
  const contract = await readFile(contractPath, 'utf8')
  const sheet = buildObservationSheet()

  assert.equal(sheet.requirements.length, 11)
  assert.equal(sheet.study.maxObservationWindowHours, 24)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  assert.deepEqual(M3_EXPECTED_RETAILERS, {
    baseline: 'PLUS',
    candidate: 'DekaMarkt',
  })

  assert.equal(contract.includes('same 11 ingredient requirements'), true)
  assert.equal(contract.includes('24-hour study window'), true)
  assert.equal(contract.includes(`**baseline = ${M3_EXPECTED_RETAILERS.baseline}**`), true)
  assert.equal(contract.includes(`**candidate = ${M3_EXPECTED_RETAILERS.candidate}**`), true)
})

test('M3 field run keeps the exact canonical 11-line demand until genuine evidence is captured', () => {
  const sheet = buildObservationSheet()

  assert.equal(sheet.selectedMealCount, 4)
  assert.deepEqual(
    sheet.requirements,
    canonicalM3Demand,
    'canonical issue #78 demand changed; revise the field-study contract deliberately before collecting evidence',
  )
  assert.deepEqual(
    sheet.baseline.lines.map((line) => ({
      id: line.ingredientId,
      label: line.ingredientLabel,
      amount: line.requirement.amount,
      unit: line.requirement.unit,
    })),
    canonicalM3Demand.map(({ id, label, amount, unit }) => ({ id, label, amount, unit })),
  )
  assert.deepEqual(
    sheet.candidate.lines.map((line) => ({
      id: line.ingredientId,
      label: line.ingredientLabel,
      amount: line.requirement.amount,
      unit: line.requirement.unit,
    })),
    canonicalM3Demand.map(({ id, label, amount, unit }) => ({ id, label, amount, unit })),
  )
})
