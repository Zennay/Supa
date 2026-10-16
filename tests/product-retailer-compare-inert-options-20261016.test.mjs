import assert from 'node:assert/strict'
import test from 'node:test'
import { compareApprovedLocalCatalog } from '../scraper/retailer-compare-approved.mjs'

// Product-owned regression: purely direct, inert argument admission.
// Nothing here creates a store, contacts a retailer or grants source rights.
const refused = /Private matched retailer comparison refused/u
const input = () => ({
  query: 'fictieve cacao', dbPath: '/nonexistent/never-create.sqlite',
  policyPath: '/nonexistent/never-read-policy.json',
  sourceGatePath: '/nonexistent/never-read-permission.json',
})

test('direct private comparison rejects every executable option getter before I/O', async () => {
  for (const name of ['query','dbPath','policyPath','sourceGatePath','now','write']) {
    const options = input()
    let executed = 0
    Object.defineProperty(options, name, {
      enumerable: true, get() { executed++; throw new Error('getter executed') },
    })
    await assert.rejects(compareApprovedLocalCatalog(options), refused)
    assert.equal(executed, 0, name)
  }
})

test('direct private comparison refuses Proxy without invoking get or ownKeys', async () => {
  let executed = 0
  const options = new Proxy(input(), {
    get() { executed++; throw new Error('get executed') },
    ownKeys() { executed++; throw new Error('ownKeys executed') },
  })
  await assert.rejects(compareApprovedLocalCatalog(options), refused)
  assert.equal(executed, 0)
})

test('direct private comparison never runs overridden Date clock methods', async () => {
  let executed = 0
  class HostileClock extends Date {
    getTime() { executed++; throw new Error('clock executed') }
  }
  await assert.rejects(compareApprovedLocalCatalog({
    ...input(), now: new HostileClock('2026-10-16T12:00:00Z'),
  }), refused)
  assert.equal(executed, 0)
  const ownOverride = new Date('2026-10-16T12:00:00Z')
  ownOverride.getTime = () => { executed++; throw new Error('own clock executed') }
  await assert.rejects(compareApprovedLocalCatalog({
    ...input(), now: ownOverride,
  }), refused)
  assert.equal(executed, 0)
})

test('direct private comparison rejects inherited/symbol/exotic/non-data options', async () => {
  const variants = [
    Object.assign(Object.create({ query: 'inherited' }), input()),
    Object.assign(Object.create(null), input(), { unexpected: 1 }),
    Object.assign(input(), { [Symbol('inert')]: 1 }),
    [],
    null,
    { ...input(), now: new Proxy(new Date(), {}) },
  ]
  for (const candidate of variants) {
    await assert.rejects(compareApprovedLocalCatalog(candidate), refused)
  }
  const hidden = input()
  Object.defineProperty(hidden, 'hidden', { value: true })
  await assert.rejects(compareApprovedLocalCatalog(hidden), refused)
})

test('plain direct options still fail closed without a genuine rights grant or file creation', async () => {
  await assert.rejects(compareApprovedLocalCatalog({
    ...input(), now: new Date('2026-10-16T12:00:00Z'),
    write: () => { throw Error('private output before permission') },
  }), refused)
  await assert.rejects(compareApprovedLocalCatalog({
    ...input(), query: null,
  }), refused)
})
