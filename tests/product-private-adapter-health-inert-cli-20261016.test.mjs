import assert from 'node:assert/strict'
import test from 'node:test'
import { main } from '../scripts/retailer-private-adapter-health.mjs'

// Direct in-process CLI invocation only: historical committed six-shape
// fixtures, no external retailer HTTP, source permission or current prices.
const REFUSAL = /Private retailer adapter health review refused/

test('health CLI still emits only a safe private historical summary for ordinary zero args', async () => {
  let output = ''
  const result = await main([], text => { output += text })
  const printed = JSON.parse(output)
  assert.equal(printed.mode, 'private-reviewed-adapter-health')
  assert.equal(printed.sources, 6)
  assert.equal(printed.permissionVerified, false)
  assert.equal(printed.productionEnabled, false)
  assert.equal(printed.publicSavingsClaimEligible, false)
  assert.equal(printed.externalRequests, 0)
  assert.equal(printed.observations, result.observations)
  assert.doesNotMatch(output, /https?:\/\/|access_token|currentPriceCents|sourceProductId/)
})

test('the exported CLI refuses root argv Proxy without reading its trap', async () => {
  let gets = 0
  let output = ''
  const args = new Proxy([], {
    get() { gets++; throw Error('QA SYNTHETIC CLI GET LEAK') },
    getOwnPropertyDescriptor() { gets++; throw Error('QA SYNTHETIC CLI DESCRIPTOR LEAK') },
  })
  await assert.rejects(main(args, text => { output += text }), REFUSAL)
  assert.equal(gets, 0)
  assert.equal(output, '')
})

test('the exported CLI refuses revoked argv Proxy with domain Error, never native TypeError', async () => {
  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  let output = ''
  await assert.rejects(main(revoked.proxy, text => { output += text }), e =>
    !(e instanceof TypeError) && REFUSAL.test(String(e)))
  assert.equal(output, '')
})

test('the exported CLI refuses spoofed empty Proxy, nonempty args and exotic array prototypes', async () => {
  let called = 0
  const spoof = new Proxy(['--publish'], {
    get(target, key) {
      called++
      if (key === 'length') return 0
      return Reflect.get(target, key)
    },
  })
  await assert.rejects(main(spoof, () => { called++ }), REFUSAL)
  assert.equal(called, 0)
  await assert.rejects(main(['--publish'], () => { called++ }), REFUSAL)
  const exotic = []
  Object.setPrototypeOf(exotic, Object.create(Array.prototype))
  await assert.rejects(main(exotic, () => { called++ }), REFUSAL)
  assert.equal(called, 0)
})
