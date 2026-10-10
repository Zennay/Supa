import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, lstat, readFile, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Controlled synthetic values only. These are NOT real PLUS or DekaMarkt evidence.
function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'symlink-parent-qa',
    participantKey: 'synthetic-participant-001',
    population: 'synthetic test population',
    region: 'synthetic test region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, storeName, storeId] of [
    ['baseline', 'PLUS synthetic fixture', 'synthetic-plus'],
    ['candidate', 'DekaMarkt synthetic fixture', 'synthetic-deka'],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = `${side}-synthetic-001`
    observation.observedAt = side === 'baseline'
      ? '2026-10-07T12:00:00Z'
      : '2026-10-07T13:00:00Z'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'SYNTHETIC TEST ONLY, not store observations'
    observation.store.id = storeId
    observation.store.name = storeName
    observation.lines.forEach((line, index) => {
      const demand = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: `${storeId}-${demand.id}`,
        productName: demand.query,
        packAmount: demand.amount,
        packUnit: demand.unit,
        packCount: 1,
        priceCents: 100 + index,
        sourceUrl: '',
        note: 'Synthetic QA data',
      }
    })
  }
  return sheet
}

function runCli(script, input, output) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', script, input, '--output', output,
  ], { cwd: process.cwd(), encoding: 'utf8' })
}

for (const [label, script] of [
  ['converter', 'scripts/m3-build-observed-study.mjs'],
  ['assessor', 'scripts/m3-assess-observed-week.mjs'],
]) {
  test(`QA M3 ${label} refuses a symlinked parent output directory`, {
    skip: process.platform === 'win32',
  }, async () => {
    const root = await mkdtemp(join(tmpdir(), `supa-${label}-parent-qa-`))
    try {
      const input = join(root, 'input.json')
      const redirected = join(root, 'redirected-evidence-folder')
      const alias = join(root, 'intended-evidence-folder')
      const output = join(alias, 'derived.json')
      await mkdir(redirected, { mode: 0o700 })
      await symlink(redirected, alias, 'dir')
      const data = label === 'converter'
        ? syntheticSheet()
        : buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
      const original = JSON.stringify(data)
      await writeFile(input, original)
      const result = runCli(script, input, output)
      assert.notEqual(result.status, 0, 'never write private evidence through a directory alias')
      assert.equal(result.stdout, '', 'reject without exposing the study/report')
      await assert.rejects(stat(join(redirected, 'derived.json')), { code: 'ENOENT' })
      assert.equal((await lstat(alias)).isSymbolicLink(), true)
      assert.equal(await readFile(input, 'utf8'), original, 'leave collection input untouched')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test(`QA M3 ${label} still writes a private new artifact into a normal directory`, {
    skip: process.platform === 'win32',
  }, async () => {
    const root = await mkdtemp(join(tmpdir(), `supa-${label}-normal-parent-`))
    try {
      const input = join(root, 'input.json')
      const output = join(root, 'new-private', 'nested', 'derived.json')
      const data = label === 'converter'
        ? syntheticSheet()
        : buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
      await writeFile(input, JSON.stringify(data))
      const result = runCli(script, input, output)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '')
      assert.equal((await stat(output)).mode & 0o777, 0o600)
      assert.equal((await stat(join(root, 'new-private'))).mode & 0o777, 0o700)
      const artifact = JSON.parse(await readFile(output, 'utf8'))
      assert.equal(artifact.schemaVersion, 1)
      if (label === 'assessor') assert.equal(artifact.publicSavingsClaimEligible, false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
