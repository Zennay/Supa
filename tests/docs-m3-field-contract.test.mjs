import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const contractPath = 'docs/M3_OBSERVED_BASKET_STUDY.md'
const packagePath = 'package.json'

const expectedM3Scripts = [
  'm3:create-observation-sheet',
  'm3:build-observed-study',
  'm3:assess-observed-week',
]

test('M3 field contract keeps the canonical evidence-collection boundary explicit', async () => {
  const contract = await readFile(contractPath, 'utf8')

  for (const requiredText of [
    'current `main` revision',
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
