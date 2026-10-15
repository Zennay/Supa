import assert from 'node:assert/strict'
import test from 'node:test'
import {
  main,
  runPrivateRetailerPipeline,
  verifyPrivateRetailerPipeline,
} from '../scripts/retailer-private-offline-end-to-end.mjs'

const refusal = /Private offline retailer pipeline refused/
const fakeDir = 'nonexistent-private-m3-test-directory'

// Product-owned trust-boundary proof. No retailer requests or private reports.
test('product: inherited getter options never run for either creation or replay', async () => {
  let calls = 0
  const options = Object.create({
    get referenceTime() { calls += 1; return '2026-10-15T21:00:00Z' },
  })
  await assert.rejects(runPrivateRetailerPipeline(fakeDir, options), refusal)
  await assert.rejects(verifyPrivateRetailerPipeline(fakeDir, options), refusal)
  assert.equal(calls, 0)
})

test('product: own nonenumerable and enumerable accessor options are inert and refused', async () => {
  for (const enumerable of [true, false]) {
    let calls = 0
    const options = {}
    Object.defineProperty(options, 'referenceTime', {
      enumerable,
      get() { calls += 1; return '2026-10-15T21:00:00Z' },
    })
    await assert.rejects(verifyPrivateRetailerPipeline(fakeDir, options), refusal)
    assert.equal(calls, 0)
  }
})

test('product: Proxy and revoked Proxy option traps never run', async () => {
  let calls = 0
  const traps = new Proxy({}, {
    get() { calls += 1; throw new Error('private getter label') },
    getOwnPropertyDescriptor() { calls += 1; throw new Error('private descriptor label') },
    ownKeys() { calls += 1; throw new Error('private ownkeys label') },
    getPrototypeOf() { calls += 1; throw new Error('private prototype label') },
  })
  await assert.rejects(verifyPrivateRetailerPipeline(fakeDir, traps), refusal)
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  await assert.rejects(runPrivateRetailerPipeline(fakeDir, revoked.proxy), refusal)
  assert.equal(calls, 0)
})

test('product: inherited array slots cannot launch a synthetic offline pipeline', async () => {
  let calls = 0
  const prototype = Object.create(Array.prototype)
  for (const [index, value] of [['0', '--dir'], ['1', fakeDir], ['2', '--verify']]) {
    Object.defineProperty(prototype, index, {
      get() { calls += 1; return value },
    })
  }
  const argv = new Array(3)
  Object.setPrototypeOf(argv, prototype)
  let output = ''
  await assert.rejects(main(argv, text => { output += text }), refusal)
  assert.equal(calls, 0)
  assert.equal(output, '')
})

test('product: own accessor array slot cannot launch or leak private output', async () => {
  let calls = 0
  const argv = ['--dir', fakeDir, '--verify']
  Object.defineProperty(argv, 1, {
    get() { calls += 1; return fakeDir },
  })
  let output = ''
  await assert.rejects(main(argv, text => { output += text }), refusal)
  assert.equal(calls, 0)
  assert.equal(output, '')
})

test('product: Proxy and revoked Proxy argv fail before introspection', async () => {
  let calls = 0
  const argv = new Proxy(['--dir', fakeDir, '--verify'], {
    get() { calls += 1; throw new Error('private-argv-get') },
    getPrototypeOf() { calls += 1; throw new Error('private-argv-proto') },
  })
  await assert.rejects(main(argv, () => {}), refusal)
  const revoked = Proxy.revocable(['--dir', fakeDir, '--verify'], {})
  revoked.revoke()
  await assert.rejects(main(revoked.proxy, () => {}), refusal)
  assert.equal(calls, 0)
})

test('product: inert own input reaches normal private source refusal without claiming evidence', async () => {
  await assert.rejects(verifyPrivateRetailerPipeline(fakeDir, {
    referenceTime: '2026-10-15T21:00:00.000Z',
  }), refusal)
  let output = ''
  await assert.rejects(main(['--dir', fakeDir, '--verify'], text => { output += text }), refusal)
  assert.equal(output, '')
  // Inert options with unexpected own keys and symbols also refuse.
  await assert.rejects(verifyPrivateRetailerPipeline(fakeDir, { publishing: true }), refusal)
  await assert.rejects(verifyPrivateRetailerPipeline(fakeDir, {
    [Symbol('private')]: 'ignored',
  }), refusal)
})
