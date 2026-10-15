import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
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

test('product: invalid explicit audit clocks are refused before publishing a private manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-product-bad-clock-'))
  try {
    for (const [index, fixture] of RETAILER_REVIEWED_FIXTURES.entries()) {
      const contents = await readFile(new URL('../fixtures/m1/' + fixture, import.meta.url))
      await writeFile(join(directory, 'capture-' + index + '.json'), contents,
        { mode: 0o600, flag: 'wx' })
    }
    const before = await readdir(directory)
    for (const badClock of [undefined, null, 42, {}, [], 'tomorrow',
      '2026-02-30T10:00:00Z', '2026-10-15T25:00:00Z',
      '2026-10-15T10:00:00+14:30', '2026-10-15T10:00:00.1234567890Z']) {
      await assert.rejects(
        runPrivateRetailerPipeline(directory, { referenceTime: badClock }),
        refusal,
      )
      assert.deepEqual(await readdir(directory), before,
        'invalid clock cannot create an irreversible no-clobber manifest')
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

// Deliberately place the audit clock after the synthetic historical captures;
// replay semantics reject captures from the future, correctly and by design.
test('product: valid UTC-offset and nanosecond clocks replay a real six-source private manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-product-valid-clock-'))
  try {
    for (const [index, fixture] of RETAILER_REVIEWED_FIXTURES.entries()) {
      const contents = await readFile(new URL('../fixtures/m1/' + fixture, import.meta.url))
      await writeFile(join(directory, 'capture-' + index + '.json'), contents,
        { mode: 0o600, flag: 'wx' })
    }
    const created = await runPrivateRetailerPipeline(directory, {
      referenceTime: '2030-01-01T12:00:00.000000001+02:00',
    })
    assert.equal(created.manifestCreated, true)
    const originalManifest = await readFile(join(directory, 'manifest.json'))
    for (const time of ['2030-01-01T10:00Z',
      '2030-01-01T12:00:00.000000001+02:00',
      '2030-01-01T05:00:00.000000009-05:00']) {
      const verified = await verifyPrivateRetailerPipeline(directory, {
        referenceTime: time,
      })
      assert.equal(verified.manifestVerified, true)
      assert.equal(verified.pinnedSources, 6)
      assert.equal(verified.publicSavingsClaimEligible, false)
      assert.equal(verified.externalRequests, 0)
      assert.deepEqual(await readFile(join(directory, 'manifest.json')), originalManifest)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
