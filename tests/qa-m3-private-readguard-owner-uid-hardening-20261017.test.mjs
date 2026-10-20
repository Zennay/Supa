import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { safePrivateM3Progress } from '../scripts/qa-m3-private-field-progress-readguard-20261017.mjs'

// Simulated owner identity: no actual root/sudo/chown or third-party files.
const CANARY = 'PRIVATE_SYNTHETIC_UID_OPERATOR_928173'
const NOW = Date.parse('2026-10-17T08:00:00Z')

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-uid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await chmod(directory, 0o700)
  const file = join(directory, 'private.json')
  const sheet = buildObservationSheet()
  sheet.study.participantKey = CANARY
  await writeFile(file, JSON.stringify(sheet), { mode: 0o600 })
  return file
}

async function withSimulatedUid(uid, callback) {
  const original = process.getuid
  process.getuid = () => uid
  try { return await callback() }
  finally { process.getuid = original }
}

test('actual local UID accepts private 0600 canonical draft without public money claims', async t => {
  const file = await setup(t)
  const result = await safePrivateM3Progress(file, NOW)
  assert.equal(result.progress.expectedLines, 22)
  assert.equal(result.verifiedRetailerObservations, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('simulated foreign UID refuses even readable mode-0600 evidence without leaking canary', async t => {
  const file = await setup(t)
  const other = process.getuid() === 0 ? 1 : 0
  await withSimulatedUid(other, async () => {
    await assert.rejects(() => safePrivateM3Progress(file, NOW), error =>
      error.message.startsWith('Private M3 operator draft refused') &&
      !error.message.includes(CANARY) && !error.message.includes(file))
  })
})

test('noncanonical or absent process UID fails before opening the private source', async t => {
  const file = await setup(t)
  for (const uid of [NaN, -1, 1.5, Infinity, undefined, 'wrong']) {
    await withSimulatedUid(uid, async () => {
      await assert.rejects(() => safePrivateM3Progress(file, NOW),
        /Private M3 operator draft refused/u)
    })
  }
})
