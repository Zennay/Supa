import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { runPrivateRetailerPipeline, verifyPrivateRetailerPipeline, main } from
  '../scripts/retailer-private-offline-end-to-end.mjs'

// Independent programmatic-API boundary QA for the new OWNER --verify API.
// Untrusted options and argv must never execute property getter side effects.
const at = '2026-10-15T21:00:00.000Z'
const fail = /Private offline retailer pipeline refused/

test('QA control: explicit own plain-data referenceTime verifies six private archive sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-verify-options-'))
  try {
    for (const [index, fixture] of RETAILER_REVIEWED_FIXTURES.entries()) {
      const bytes = await readFile(new URL('../fixtures/m1/' + fixture, import.meta.url))
      await writeFile(join(directory, 'capture-' + index + '.json'), bytes,
        { mode: 0o600, flag: 'wx' })
    }
    await runPrivateRetailerPipeline(directory, { referenceTime: at })
    const result = await verifyPrivateRetailerPipeline(directory, { referenceTime: at })
    assert.equal(result.mode, 'private-offline-retailer-verified-pipeline')
    assert.equal(result.pinnedSources, 6)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.externalRequests, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('QA fail-closed: inherited referenceTime getter must be refused without executing code', async () => {
  let calls = 0
  const opts = Object.create({
    get referenceTime() { calls++; return at },
  })
  await assert.rejects(verifyPrivateRetailerPipeline('nonexistent-qa-private-dir', opts), fail)
  assert.equal(calls, 0, 'inherited getter must not execute before option validation')
})

test('QA fail-closed: own enumerable referenceTime accessor must be refused before getter evaluation', async () => {
  let calls = 0
  const opts = {}
  Object.defineProperty(opts, 'referenceTime', {
    enumerable: true,
    get() { calls++; return at },
  })
  await assert.rejects(verifyPrivateRetailerPipeline('nonexistent-qa-private-dir', opts), fail)
  assert.equal(calls, 0, 'own accessor getter must not execute in a privileged evidence verifier')
})

test('QA fail-closed: sparse inherited argv getters cannot trigger a --verify operation', async () => {
  let calls = 0
  const proto = Object.create(Array.prototype)
  for (const [index, value] of [['0', '--dir'], ['1', 'nonexistent-qa-private-dir'], ['2', '--verify']]) {
    Object.defineProperty(proto, index, {
      get() { calls++; return value },
      enumerable: true,
    })
  }
  const argv = new Array(3)
  Object.setPrototypeOf(argv, proto)
  let output = ''
  await assert.rejects(main(argv, text => { output += text }), fail)
  assert.equal(calls, 0, 'inherited argv must be rejected before property access')
  assert.equal(output, '')
})
