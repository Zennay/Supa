/**
 * Independent SUPA M3 quality-validation on the exported private six-adapter
 * health CLI call boundary. Synthetic local programmatic argv only; no network,
 * retailer credentials, user facts, real current prices or public claims.
 *
 * These tests are QA-owned and MUST stay unchanged for fixed-owner replay.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../scripts/retailer-private-adapter-health.mjs'

const refused = /Private retailer adapter health review refused/

test('health CLI accepts only an ordinary empty argv for real historical six-shape private output', async () => {
  const printed = []
  const result = await main([], line => printed.push(line))
  assert.equal(printed.length, 1)
  assert.deepEqual(JSON.parse(printed[0]), result)
  assert.equal(result.sources, 6)
  assert.equal(result.acceptedSources, 6)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.externalRequests, 0)
  assert.doesNotMatch(printed[0], /https?:\/\/|sourceProductId|currentPriceCents|offerPriceCents|access_token/i)
})

test('health CLI refuses root argv Proxy before executing caller get trap [EXPECTED RED]', async () => {
  let traps = 0
  let writes = 0
  const proxy = new Proxy([], {
    get() { traps++; throw new Error('QA SYNTHETIC CLI ARG GET TRAP RAN') },
  })
  await assert.rejects(main(proxy, () => { writes++ }), refused)
  assert.equal(traps, 0)
  assert.equal(writes, 0)
})

test('health CLI refuses revoked argv Proxy using the domain error, not native TypeError [EXPECTED RED]', async () => {
  const { proxy, revoke } = Proxy.revocable([], {})
  revoke()
  let writes = 0
  await assert.rejects(main(proxy, () => { writes++ }), error =>
    !(error instanceof TypeError) && refused.test(String(error)))
  assert.equal(writes, 0)
})

test('health CLI refuses Proxy spoofing empty length for nonempty actual argv [EXPECTED RED]', async () => {
  let traps = 0
  let writes = 0
  const actual = ['--enable-live']
  const spoof = new Proxy(actual, {
    get(target, key) {
      traps++
      return key === 'length' ? 0 : Reflect.get(target, key)
    },
  })
  await assert.rejects(main(spoof, () => { writes++ }), refused)
  assert.equal(traps, 0)
  assert.equal(writes, 0)
})

test('health CLI refuses inherited argument slots before reading their getters [EXPECTED RED]', async () => {
  let traps = 0
  let writes = 0
  const args = new Array(1)
  Object.defineProperty(args, '0', {
    enumerable: true, configurable: true,
    get() { traps++; throw new Error('QA SYNTHETIC CLI INHERITED SLOT TRAP') },
  })
  await assert.rejects(main(args, () => { writes++ }), refused)
  assert.equal(traps, 0)
  assert.equal(writes, 0)
})

test('health CLI preserves denial for ordinary explicit flags and emits nothing', async () => {
  let output = ''
  await assert.rejects(main(['--publish'], item => { output += item }), refused)
  assert.equal(output, '')
})
