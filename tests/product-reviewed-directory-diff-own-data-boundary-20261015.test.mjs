import assert from 'node:assert/strict'
import test from 'node:test'
import { compareReviewedDirectories, main } from '../scripts/retailer-private-reviewed-directory-diff.mjs'

const refused = /Private retailer reviewed directory diff refused/
const nonexistent = 'supa-fake-private-dir-A'
const other = 'supa-fake-private-dir-B'

test('product: regular own-data options and programmatic argv keep private refusal', async () => {
  await assert.rejects(compareReviewedDirectories(nonexistent, other,
    { referenceTime: '2026-10-15T21:00:00Z' }), refused)
  let output = ''
  await assert.rejects(main(['--before-dir', nonexistent, '--after-dir', other, '--at',
    '2026-10-15T21:00:00Z'], text => { output += text }), refused)
  assert.equal(output, '')
})

test('product: inherited referenceTime getter must never execute before filesystem refusal', async () => {
  let calls = 0
  const options = Object.create({
    get referenceTime() { calls++; return '2026-10-15T21:00:00Z' },
  })
  await assert.rejects(compareReviewedDirectories(nonexistent, other, options), refused)
  assert.equal(calls, 0)
})

test('product: own accessor referenceTime getter must never execute', async () => {
  for (const enumerable of [true, false]) {
    let calls = 0
    const options = {}
    Object.defineProperty(options, 'referenceTime', {
      enumerable,
      get() { calls++; return '2026-10-15T21:00:00Z' },
    })
    await assert.rejects(compareReviewedDirectories(nonexistent, other, options), refused)
    assert.equal(calls, 0)
  }
})

test('product: Proxy and revoked Proxy options never trigger trap reflection', async () => {
  let calls = 0
  const options = new Proxy({}, {
    get() { calls++; throw Error('private option getter leak') },
    ownKeys() { calls++; throw Error('private option keys leak') },
    getPrototypeOf() { calls++; throw Error('private option prototype leak') },
  })
  await assert.rejects(compareReviewedDirectories(nonexistent, other, options), refused)
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  await assert.rejects(compareReviewedDirectories(nonexistent, other, revoked.proxy), refused)
  assert.equal(calls, 0)
})

test('product: sparse argv inherited directory and flag getters never run', async () => {
  let calls = 0
  const prototype = Object.create(Array.prototype)
  for (const [key, value] of [['0', '--before-dir'], ['1', nonexistent],
    ['2', '--after-dir'], ['3', other], ['4', '--at'], ['5', '2026-10-15T21:00:00Z']]) {
    Object.defineProperty(prototype, key, { get() { calls++; return value } })
  }
  const argv = new Array(6)
  Object.setPrototypeOf(argv, prototype)
  let output = ''
  await assert.rejects(main(argv, text => { output += text }), refused)
  assert.equal(calls, 0)
  assert.equal(output, '')
})

test('product: own accessor argv and mixed normal slots cannot trigger a read', async () => {
  let calls = 0
  const argv = ['--before-dir', nonexistent, '--after-dir', other]
  Object.defineProperty(argv, 2, {
    get() { calls++; return '--after-dir' },
  })
  let output = ''
  await assert.rejects(main(argv, text => { output += text }), refused)
  assert.equal(calls, 0)
  assert.equal(output, '')
})

test('product: Proxy and revoked Proxy argv are rejected without traps', async () => {
  let calls = 0
  const argv = new Proxy(['--before-dir', nonexistent, '--after-dir', other], {
    get() { calls++; throw Error('private argv getter leak') },
    getPrototypeOf() { calls++; throw Error('private argv proto leak') },
  })
  await assert.rejects(main(argv, () => {}), refused)
  const revoked = Proxy.revocable(['--before-dir', nonexistent, '--after-dir', other], {})
  revoked.revoke()
  await assert.rejects(main(revoked.proxy, () => {}), refused)
  assert.equal(calls, 0)
})

test('product: explicit undefined, symbols and extra option fields refuse without output', async () => {
  await assert.rejects(compareReviewedDirectories(nonexistent, other, {
    referenceTime: undefined,
  }), refused)
  await assert.rejects(compareReviewedDirectories(nonexistent, other, {
    [Symbol('private')]: true,
  }), refused)
  await assert.rejects(compareReviewedDirectories(nonexistent, other, {
    release: true,
  }), refused)
})
