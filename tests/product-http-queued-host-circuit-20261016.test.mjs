import test from 'node:test'
import assert from 'node:assert/strict'
import { PoliteFetcher, HttpStatusError, HostBlockedError } from '../scraper/lib/http.mjs'

// Product-owner regressions for the scheduler itself. Synthetic promises only;
// no DNS, source permission, browser or retailer transport.
const HOST = 'shop.example.test'
const URL = `https://${HOST}/fictional`

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, release() { resolve() } }
}

test('a queued task cannot enter transport between 401 failure and outer request catch', async () => {
  const firstGate = deferred()
  const entered = deferred()
  const calls = []
  const client = new PoliteFetcher({ respectRobots: false, minDelayMs: 0 })
  const first = client.schedule(HOST, async () => {
    calls.push('first')
    entered.release()
    await firstGate.promise
    throw new HttpStatusError(URL, 401)
  })
  await entered.promise
  const second = client.schedule(HOST, async () => { calls.push('second') })
  const secondOutcome = second.then(() => null, (e) => e)
  firstGate.release()
  await assert.rejects(first, HttpStatusError)
  assert.ok(await secondOutcome instanceof HostBlockedError)
  assert.equal(client.isBlocked(HOST), 'HTTP 401')
  assert.deepEqual(calls, ['first'])
})

test('host blocked during a politeness wait does not start queued transport', async () => {
  const waiting = deferred()
  const resume = deferred()
  const calls = []
  const client = new PoliteFetcher({
    now: () => 0,
    minDelayMs: 0, respectRobots: false,
    sleepImpl: async () => { waiting.release(); await resume.promise },
  })
  client.hostState(HOST).nextAt = 100
  const task = client.schedule(HOST, async () => { calls.push('transport') })
  const outcome = task.then(() => null, (e) => e)
  await waiting.promise
  client.hostState(HOST).blocked = 'HTTP 403'
  resume.release()
  assert.ok(await outcome instanceof HostBlockedError)
  assert.deepEqual(calls, [])
})
