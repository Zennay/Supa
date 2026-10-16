import test from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../scripts/retailer-private-civil-clock-preflight.mjs'

// Independent QA-only admission regressions on #3706's separately exported,
// fixed-fixture private CLI. Related existing exported-ingestion argv P2 #3696.
// Do not invoke live retailer HTTP, mutating permissions or custom paths.
// Two safe fixed refusal boundaries are acceptable: the shared inert-data
// admission or the explicit CLI preflight. Neither may execute caller traps.
const DENIED = /(?:Private retailer capture civil-clock preflight refused|Reviewed retailer evidence must be inert JSON data)/

test('CLI positive: exact empty array lists only private aggregate counts', async () => {
  let output = ''
  const summary = await main([], line => { output += line })
  const parsed = JSON.parse(output)
  assert.equal(summary.acceptedSources, 6)
  assert.equal(summary.rejectedSources, 0)
  assert.equal(parsed.civilClockPreflight, true)
  assert.equal(parsed.productionEnabled, false)
  assert.equal(parsed.permissionVerified, false)
  assert.equal(parsed.publicSavingsClaimEligible, false)
  assert.equal(output.includes('https://'), false)
})

test('CLI refuses forged flags and an arbitrary object without reporting caller input', async () => {
  let output = ''
  await assert.rejects(main(['--input', 'https://unreviewed.example.invalid/secret'], line => { output += line }), DENIED)
  await assert.rejects(main({ length: 0 }, line => { output += line }), DENIED)
  assert.equal(output, '')
})

test('exported CLI must reject a benign-looking array Proxy without executing its traps', async () => {
  let traps = 0
  let output = ''
  const argv = new Proxy([], {
    get(target, key, receiver) {
      traps += 1
      return Reflect.get(target, key, receiver)
    },
  })
  await assert.rejects(main(argv, line => { output += line }), DENIED)
  assert.equal(traps, 0, 'no caller Proxy property must be read before admission')
  assert.equal(output, '')
})

test('exported CLI must refuse a malicious array length trap without running it', async () => {
  let touches = 0
  let output = ''
  const argv = new Proxy([], {
    get(_target, property) {
      touches += 1
      throw new Error('untrusted argv Proxy trap: ' + String(property))
    },
  })
  await assert.rejects(main(argv, line => { output += line }), DENIED)
  assert.equal(touches, 0)
  assert.equal(output, '')
})

test('revoked argv Proxy cannot leak a different JS exception to caller', async () => {
  const arg = Proxy.revocable([], {})
  arg.revoke()
  let output = ''
  await assert.rejects(main(arg.proxy, line => { output += line }), DENIED)
  assert.equal(output, '')
})
