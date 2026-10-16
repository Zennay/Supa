/**
 * Independent QA reference: snapshot accepted, inert JavaScript data without
 * triggering getters or Proxy traps. This is NOT a production admission,
 * retailer license, authorization, or substitute for canonical M3 validators.
 *
 * The exported M3 API can receive in-process JS objects although its normal
 * operator CLI reads JSON. Reviewed JSON never contains accessors or Proxies.
 * Reject such active values before reading them, then hand immutable copies
 * to the existing canonical source/provenance/permission validators.
 */
import { types as nodeTypes } from 'node:util'

const MAX_DEPTH = 32
const MAX_NODES = 50_000
const MAX_ARRAY_LENGTH = 10_000
const MAX_OBJECT_PROPERTIES = 2_048
const MAX_STRING = 100_000
const refuse = () => { throw new Error('Inert historical retailer QA snapshot refused') }
const indexKey = key => /^(?:0|[1-9]\d*)$/.test(key)

function copyInert(root) {
  let visitedNodes = 0
  const memo = new WeakMap()
  const active = new WeakSet()

  function visit(value, depth) {
    if (++visitedNodes > MAX_NODES || depth > MAX_DEPTH) refuse()
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.length > MAX_STRING) refuse()
      return value
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) refuse()
      return value
    }
    if (typeof value !== 'object' || nodeTypes.isProxy(value)) refuse()
    if (active.has(value)) refuse()
    if (memo.has(value)) return memo.get(value)

    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (array ? prototype !== Array.prototype :
      prototype !== Object.prototype && prototype !== null) refuse()
    if (array && value.length > MAX_ARRAY_LENGTH) refuse()

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length > MAX_OBJECT_PROPERTIES && !array) refuse()
    if (keys.some(key => typeof key !== 'string')) refuse()

    if (array) {
      const length = descriptors.length
      if (!length || !Object.hasOwn(length, 'value') ||
          length.value !== value.length ||
          keys.length !== value.length + 1) refuse()
      for (let index = 0; index < length.value; index++) {
        if (!Object.hasOwn(descriptors, index) ||
            !Object.hasOwn(descriptors[index], 'value')) refuse()
      }
      if (keys.some(key => key !== 'length' &&
          (!indexKey(key) || Number(key) >= value.length))) refuse()
    }

    const output = array ? new Array(value.length) : Object.create(prototype)
    memo.set(value, output)
    active.add(value)
    for (const key of keys) {
      if (array && key === 'length') continue
      const descriptor = descriptors[key]
      if (!Object.hasOwn(descriptor, 'value')) refuse()
      const copied = visit(descriptor.value, depth + 1)
      Object.defineProperty(output, key, {
        value: copied, enumerable: descriptor.enumerable,
        configurable: true, writable: true,
      })
    }
    active.delete(value)
    return output
  }

  function freezeDeep(value, frozen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || frozen.has(value)) return
    frozen.add(value)
    for (const key of Object.keys(value)) freezeDeep(value[key], frozen)
    Object.freeze(value)
  }
  const copy = visit(root, 0)
  freezeDeep(copy)
  return copy
}

/**
 * Only checks active JS input shape. Downstream canonical validators must
 * STILL verify permission policy, all six-or-more source records, prices,
 * pack sizes, chronological provenance, releases and aggregate consistency.
 */
export function snapshotInertReviewedRetailerInputs(permissionGate, batch) {
  const tuple = copyInert({ permissionGate, batch })
  if (!tuple.permissionGate || !tuple.batch ||
      !Array.isArray(tuple.batch.results) ||
      tuple.batch.results.length < 6 || tuple.batch.results.length > 32) refuse()
  return tuple
}
