import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildM3FieldKit, writeM3FieldKit } from '../scripts/m3-prepare-field-kit.mjs'

// Synthetic exported-API trust only: no retailer reads or real participants.
// A caller-provided getter can change the file after the writer validates it.
// Secure outcomes are rejection without writes OR persistence of canonical bytes.
const SHA = 'f'.repeat(40)

async function exercise(t, name, mutableKit, canonical) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-getter-qa-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const dest = join(root, 'private-kit')
  let refused = false
  try {
    await writeM3FieldKit(dest, mutableKit)
  } catch {
    refused = true
  }
  if (refused) {
    assert.equal(existsSync(dest), false,
      name + ': fail closed BEFORE creating partially trusted evidence folder')
    return
  }
  for (const filename of Object.keys(canonical)) {
    assert.equal(await readFile(join(dest, filename), 'utf8'), canonical[filename],
      name + ': saved bytes must equal exactly those validated, not a later getter value')
  }
}

test('exported writer must pin collection sheet bytes across getter-based validation/write swap', async t => {
  const canonical = buildM3FieldKit({ branch: 'main', sha: SHA })
  const poisoned = { ...canonical }
  const altered = canonical['collection-sheet.json']
    .replace('"available": null', '"available": true')
  assert.notEqual(altered, canonical['collection-sheet.json'])
  let reads = 0
  Object.defineProperty(poisoned, 'collection-sheet.json', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1
      // First read by typeof; second for canonical equality. Third read is
      // the later physical write, which must not accept an altered file.
      return reads <= 2 ? canonical['collection-sheet.json'] : altered
    },
  })
  await exercise(t, 'collection sheet', poisoned, canonical)
  // A fixed writer is allowed to reject the accessor without invoking it.
  assert.equal(typeof Object.getOwnPropertyDescriptor(poisoned, 'collection-sheet.json').get,
    'function', 'adversarial accessor is genuinely present')
})

test('exported writer must pin revision proof flags across getter-based validation/write swap', async t => {
  const canonical = buildM3FieldKit({ branch: 'main', sha: SHA })
  const poisoned = { ...canonical }
  const forged = JSON.stringify({
    ...JSON.parse(canonical['source-revision.json']),
    verifiedRetailerObservations: true,
    publicSavingsClaimEligible: true,
  }, null, 2) + '\n'
  let reads = 0
  Object.defineProperty(poisoned, 'source-revision.json', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1
      // typeof / revision parse / equality sees canonical; file write swaps
      // both explicit NOT-EVIDENCE flags to untrue forged values.
      return reads <= 3 ? canonical['source-revision.json'] : forged
    },
  })
  await exercise(t, 'revision companion', poisoned, canonical)
  // Refusing the accessor before a single getter read is the safest outcome.
  assert.equal(typeof Object.getOwnPropertyDescriptor(poisoned, 'source-revision.json').get,
    'function', 'adversarial revision accessor is genuinely present')
})
