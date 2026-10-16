import assert from 'node:assert/strict'
import test from 'node:test'
import { main } from '../scripts/retailer-private-operator-brief.mjs'

// Separate independent QA for the DIRECT EXPORTED CLI function, not its
// already-sealed renderer. Caller-controlled JS argv is not an OS CLI string.
// This tests only in-memory inert fakes and historical local fixtures: no
// real retailer HTTP, credentials, price publication or rights promotion.
const refused = /offline winkelbron-startcontrole geweigerd/i

test('positive: genuine zero-argument offline CLI produces only private human guidance', async () => {
  let output = ''
  const returned = await main([], value => { output += value })
  assert.equal(output, returned)
  assert.match(output, /^SUPA — offline winkelbron-startcontrole/)
  assert.match(output, /ALLEEN HISTORISCHE BRONNEN/)
  assert.doesNotMatch(output, /https?:\/\/|sourceProductId|currentPriceCents|€/)
})

test('exported CLI must refuse root argv Proxy BEFORE any caller get trap [EXPECTED RED]', async () => {
  let traps = 0
  const argv = new Proxy([], {
    get() { traps++; throw new Error('QA SYNTHETIC PROXY GET TRAP EXECUTED') },
  })
  await assert.rejects(main(argv, () => {}), refused)
  assert.equal(traps, 0, 'CLI boundary must never evaluate JS Proxy traps')
})

test('exported CLI must refuse revoked argv Proxy with a domain error [EXPECTED RED]', async () => {
  const { proxy, revoke } = Proxy.revocable([], {
    get() { throw new Error('QA SYNTHETIC PROXY TRAP EXECUTED') },
  })
  revoke()
  await assert.rejects(
    main(proxy, () => {}),
    error => !(error instanceof TypeError) && refused.test(String(error)),
    'do not leak a native revoked-Proxy TypeError',
  )
})

test('exported CLI must not accept fake zero length for a nonempty argv Proxy [EXPECTED RED]', async () => {
  let traps = 0
  const argv = new Proxy(['--dangerous-nonempty-argument'], {
    get(target, key, receiver) {
      traps++
      if (key === 'length') return 0
      return Reflect.get(target, key, receiver)
    },
  })
  await assert.rejects(main(argv, () => {}), refused)
  assert.equal(traps, 0, 'no accepted argument list may depend on caller Proxy')
})
