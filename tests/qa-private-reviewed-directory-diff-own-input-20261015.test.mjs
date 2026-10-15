import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareReviewedDirectories,
  main,
} from '../scripts/retailer-private-reviewed-directory-diff.mjs'

/*
 * Independent QA of the direct, private directory-diff JS API.
 * Inputs deliberately fail before filesystem access; all getters/proxy traps
 * increment only in-memory counters. No retailer requests, private capture
 * contents, observed prices, source rights, or public savings are involved.
 *
 * These tests intentionally remain RED until a product-owner implementation
 * checks own data descriptors / native Proxies before reading caller inputs.
 */

const EMPTY_BEFORE = ''
const UNUSED_AFTER = '/qa-unused-after-directory'
const AT = '2026-10-14T12:00:00.000Z'

test('control: inert own-data options with invalid directory refuse without output or reads', async () => {
  await assert.rejects(
    compareReviewedDirectories(EMPTY_BEFORE, UNUSED_AFTER, { referenceTime: AT }),
    /Private retailer reviewed directory diff refused/,
  )
  let writes = 0
  await assert.rejects(
    main(['--before-dir', EMPTY_BEFORE, '--after-dir', UNUSED_AFTER],
      () => { writes++ }),
    /Private retailer reviewed directory diff refused/,
  )
  assert.equal(writes, 0)
})

test('QA boundary: inherited referenceTime accessor must not run during refusal', async () => {
  let invocations = 0
  const options = Object.create({
    get referenceTime() {
      invocations++
      return AT
    },
  })
  await assert.rejects(compareReviewedDirectories(EMPTY_BEFORE, UNUSED_AFTER, options))
  assert.equal(invocations, 0, 'inherited options getter executed before input refusal')
})

test('QA boundary: own referenceTime accessor must not run during refusal', async () => {
  let invocations = 0
  const options = {}
  Object.defineProperty(options, 'referenceTime', {
    enumerable: true,
    get() {
      invocations++
      return AT
    },
  })
  await assert.rejects(compareReviewedDirectories(EMPTY_BEFORE, UNUSED_AFTER, options))
  assert.equal(invocations, 0, 'own options getter executed before input refusal')
})

test('QA boundary: Proxy options get trap must not run during refusal', async () => {
  let invocations = 0
  const options = new Proxy({ referenceTime: AT }, {
    get(target, property, receiver) {
      invocations++
      return Reflect.get(target, property, receiver)
    },
  })
  await assert.rejects(compareReviewedDirectories(EMPTY_BEFORE, UNUSED_AFTER, options))
  assert.equal(invocations, 0, 'Proxy options get trap executed before input refusal')
})

test('QA boundary: sparse inherited CLI argv slots must not be read', async () => {
  let invocations = 0
  const argv = new Array(4)
  const values = ['--before-dir', EMPTY_BEFORE, '--after-dir', UNUSED_AFTER]
  const prototype = Object.create(Array.prototype)
  for (let index = 0; index < values.length; index++) {
    Object.defineProperty(prototype, index, {
      get() {
        invocations++
        return values[index]
      },
    })
  }
  Object.setPrototypeOf(argv, prototype)
  let writes = 0
  await assert.rejects(main(argv, () => { writes++ }))
  assert.equal(invocations, 0, 'inherited argv getter executed before input refusal')
  assert.equal(writes, 0)
})

test('QA boundary: own CLI argv accessor must not run', async () => {
  let invocations = 0
  const argv = ['--before-dir', EMPTY_BEFORE, '--after-dir', UNUSED_AFTER]
  Object.defineProperty(argv, '0', {
    configurable: true,
    get() {
      invocations++
      return '--before-dir'
    },
  })
  await assert.rejects(main(argv, () => { throw Error('must not write') }))
  assert.equal(invocations, 0, 'own argv getter executed before input refusal')
})

test('QA boundary: Proxy CLI argv must not execute get traps', async () => {
  let invocations = 0
  const argv = new Proxy(
    ['--before-dir', EMPTY_BEFORE, '--after-dir', UNUSED_AFTER],
    {
      get(target, property, receiver) {
        invocations++
        return Reflect.get(target, property, receiver)
      },
    },
  )
  await assert.rejects(main(argv, () => { throw Error('must not write') }))
  assert.equal(invocations, 0, 'Proxy argv getter executed before input refusal')
})
