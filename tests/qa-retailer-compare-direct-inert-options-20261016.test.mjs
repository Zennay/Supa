import assert from 'node:assert/strict'
import test from 'node:test'
import { compareApprovedLocalCatalog } from '../scraper/retailer-compare-approved.mjs'

// Independent quality-validation of product #3434's newly exported direct API.
// These are in-process, synthetic caller inputs. No disk, sockets or retailers
// are touched: a trustworthy API must refuse them before any caller code runs.
const refusal = /Private matched retailer comparison refused/u

test('private compare direct export refuses active own option getters without executing them', async () => {
  for (const field of ['query', 'dbPath', 'policyPath', 'sourceGatePath', 'now', 'write']) {
    let calls = 0
    const options = { query: 'fictieve cacao', dbPath: 'never-open.sqlite',
      policyPath: 'never-read-policy.json', sourceGatePath: 'never-read-gate.json' }
    Object.defineProperty(options, field, {
      enumerable: true,
      get() {
        calls += 1
        throw new Error('UNTRUSTED_COMPARE_OPTION_GETTER_MUST_NOT_EXECUTE')
      },
    })
    await assert.rejects(
      compareApprovedLocalCatalog(options), refusal,
      'direct option ' + field + ' must have a generic private refusal',
    )
    assert.equal(calls, 0, 'direct option getter executed: ' + field)
  }
})

test('private compare direct export refuses Proxy.get without invoking caller traps', async () => {
  let traps = 0
  const options = new Proxy({}, {
    get() {
      traps += 1
      throw new Error('UNTRUSTED_COMPARE_PROXY_GET_MUST_NOT_EXECUTE')
    },
  })
  await assert.rejects(compareApprovedLocalCatalog(options), refusal)
  assert.equal(traps, 0, 'direct API invoked untrusted Proxy.get')
})

test('private compare does not execute custom Date.getTime code while checking review clock', async () => {
  let calls = 0
  class HostileDate extends Date {
    getTime() {
      calls += 1
      throw new Error('UNTRUSTED_COMPARE_DATE_METHOD_MUST_NOT_EXECUTE')
    }
  }
  await assert.rejects(compareApprovedLocalCatalog({
    query: 'fictieve cacao',
    dbPath: 'never-open.sqlite',
    policyPath: 'never-read-policy.json',
    sourceGatePath: 'never-read-gate.json',
    now: new HostileDate('2026-10-16T12:00:00.000Z'),
  }), refusal)
  assert.equal(calls, 0, 'custom Date method executed')
})

test('private compare keeps its generic failure for inert invalid arguments', async () => {
  let outputCount = 0
  await assert.rejects(compareApprovedLocalCatalog({
    query: null, dbPath: 'never-open.sqlite',
    policyPath: 'never-read-policy.json',
    write: () => { outputCount += 1 },
  }), refusal)
  assert.equal(outputCount, 0, 'invalid direct call wrote private output')
})
