import assert from 'node:assert/strict'
import test from 'node:test'
import { main } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Programmatic CLI admission is not trusted user JSON or OS command parsing.
// No HTTP, browser, permissions, credential, current price or public claims.
test('genuine no-argument historical CLI succeeds without publishing source data or retailer rights', async () => {
  const output = []
  const result = await main([], value => { output.push(value) })
  assert.equal(result.sources, 6)
  assert.equal(result.acceptedSources, 6)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.deepEqual(JSON.parse(output.join('')), result)
  assert.doesNotMatch(output.join(''), /https?:\/\/|token|cookie|currentPriceCents|productId/i)
})

test('genuine nonempty argv is rejected before emitting any archived source summary', async () => {
  const output = []
  await assert.rejects(main(['--allow-live'], value => output.push(value)), /Usage:/)
  assert.deepEqual(output, [])
})

test('forged length-zero object is not a legitimate CLI argv collection', async () => {
  const output = []
  await assert.rejects(main({ length: 0 }, value => output.push(value)), /Usage:/)
  assert.deepEqual(output, [])
})

test('Proxy array must be rejected BEFORE executing any untrusted get trap', async () => {
  let traps = 0
  const argv = new Proxy([], {
    get(_target, _property) { traps++; throw Error('UNTRUSTED_ARGV_TRAP_EXECUTED') },
    getPrototypeOf() { traps++; throw Error('UNTRUSTED_ARGV_PROTOTYPE_EXECUTED') },
  })
  await assert.rejects(main(argv, () => {}), /Usage:/)
  assert.equal(traps, 0)
})

test('argv whose length getter has side effects must not execute it during rejection', async () => {
  let calls = 0
  const argv = Object.defineProperty({}, 'length', {
    enumerable: true,
    get() { calls++; return 0 },
  })
  await assert.rejects(main(argv, () => {}), /Usage:/)
  assert.equal(calls, 0)
})

test('array entries with accessor properties are never read for CLI admission', async () => {
  let calls = 0
  const argv = ['--invalid']
  Object.defineProperty(argv, '0', {
    enumerable: true,
    get() { calls++; throw Error('ARGUMENT_GETTER_EXECUTED') },
  })
  await assert.rejects(main(argv, () => {}), /Usage:/)
  assert.equal(calls, 0)
})
