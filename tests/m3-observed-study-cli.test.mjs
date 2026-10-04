import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const cli = path.resolve('scripts/m3-validate-observed-basket-study.mjs')

function matchedBasket(storeId, storeName, lineTotalCents) {
  return {
    store: { id: storeId, name: storeName },
    selectedMealCount: 1,
    lines: [
      {
        id: 'rice',
        ingredientLabel: 'Rice',
        requirement: { amount: 100, unit: 'g' },
        status: 'matched',
        productId: `${storeId}-rice`,
        productName: 'Rice 500 g',
        packs: 1,
        pack: { amount: 500, unit: 'g', count: 1 },
        pricePerPackCents: lineTotalCents,
        lineTotalCents,
        matchScore: 100,
        reasons: ['controlled test evidence'],
      },
    ],
    totalCents: lineTotalCents,
    matchedLineCount: 1,
    unresolvedLineCount: 0,
  }
}

function observedStudy(candidateBasket = matchedBasket('store-b', 'Store B', 180)) {
  return {
    schemaVersion: 1,
    studyId: 'week-2026-40-cli',
    participantKey: 'student-cli-001',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-09-28',
    baseline: {
      evidenceId: 'basket-cli-a',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic CLI regression input; not observed savings evidence.',
      basket: matchedBasket('store-a', 'Store A', 200),
    },
    candidate: {
      evidenceId: 'basket-cli-b',
      observedAt: '2026-10-02T18:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic CLI regression input; not observed savings evidence.',
      basket: candidateBasket,
    },
  }
}

async function runCli(document) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'supa-m3-cli-'))
  const input = path.join(directory, 'study.json')
  await writeFile(
    input,
    typeof document === 'string' ? document : JSON.stringify(document),
    'utf8',
  )

  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', cli, input],
    { encoding: 'utf8' },
  )
}

test('M3 CLI emits a reproducible claimable assessment for valid study input', async () => {
  const result = await runCli(observedStudy())

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.studyId, 'week-2026-40-cli')
  assert.equal(output.claimable, true)
  assert.equal(output.outcome, 'better')
  assert.equal(output.savingsCents, 20)
  assert.equal(output.observationWindowHours, 1)
  assert.deepEqual(output.reasons, [])
})

test('M3 CLI exits 2 and suppresses savings for an unclaimable observed basket', async () => {
  const incompleteCandidate = {
    store: { id: 'store-b', name: 'Store B' },
    selectedMealCount: 1,
    lines: [
      {
        id: 'rice',
        ingredientLabel: 'Rice',
        requirement: { amount: 100, unit: 'g' },
        status: 'unresolved',
        reasons: ['receipt line could not be matched'],
        matchScore: null,
      },
    ],
    totalCents: 0,
    matchedLineCount: 0,
    unresolvedLineCount: 1,
  }

  const result = await runCli(observedStudy(incompleteCandidate))

  assert.equal(result.status, 2, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.claimable, false)
  assert.equal(output.outcome, 'unknown')
  assert.equal(output.deltaCents, null)
  assert.equal(output.savingsCents, null)
  assert.match(output.reasons.join(' '), /unresolved ingredients/)
})

test('M3 CLI exits 1 for malformed JSON instead of producing evidence output', async () => {
  const result = await runCli('{not-json')

  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Invalid observed-basket study document/)
})
