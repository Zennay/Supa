/**
 * Inert admission boundary for offline retailer JSON evidence.
 *
 * The reviewed adapters accept exported JS objects as well as parsed JSON.
 * Reading a getter, Proxy, Date, or exotic prototype while selecting a
 * retailer can execute caller code before permission and provenance checks.
 * Snapshot ONLY inert JSON-compatible own data into detached plain values,
 * before invoking adapters. No HTTP, renderer, or license elevation.
 */
import { types } from 'node:util'

const refuse = () => { throw new Error('Reviewed retailer evidence must be inert JSON data') }
const MAX_NODES = 100_000
const MAX_DEPTH = 64
const MAX_ARRAY = 65_536
const MAX_STRING = 1_048_576
const MAX_TOTAL_UTF8_BYTES = 32 * 1024 * 1024

export function snapshotInertReviewedEvidence(value) {
  let nodes = 0
  let utf8Bytes = 0
  const addBytes = text => {
    utf8Bytes += Buffer.byteLength(text, 'utf8')
    if (utf8Bytes > MAX_TOTAL_UTF8_BYTES) refuse()
  }
  const visiting = new WeakSet()
  function copy(node, depth) {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) refuse()
    if (node === null || typeof node === 'boolean') return node
    if (typeof node === 'string') {
      if (node.length > MAX_STRING) refuse()
      addBytes(node)
      return node
    }
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) refuse()
      return node
    }
    if (typeof node !== 'object' || types.isProxy(node)) refuse()
    if (visiting.has(node)) refuse()
    const array = Array.isArray(node)
    const prototype = Object.getPrototypeOf(node)
    if (array ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) refuse()
    visiting.add(node)
    try {
      const descriptors = Object.getOwnPropertyDescriptors(node)
      const keys = Reflect.ownKeys(descriptors)
      if (array) {
        const length = descriptors.length
        if (!length || !Object.hasOwn(length, 'value') ||
            !Number.isSafeInteger(length.value) || length.value > MAX_ARRAY ||
            keys.length !== length.value + 1) refuse()
        const result = []
        for (let i = 0; i < length.value; i++) {
          const property = descriptors[i]
          if (!property || !Object.hasOwn(property, 'value') ||
              property.enumerable !== true) refuse()
          result.push(copy(property.value, depth + 1))
        }
        if (keys.some(key => key !== 'length' &&
            (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) ||
             Number(key) >= length.value))) refuse()
        return result
      }
      const result = {}
      if (keys.length > MAX_NODES) refuse()
      for (const key of keys) {
        if (typeof key !== 'string') refuse()
        addBytes(key)
        const property = descriptors[key]
        if (!property || !Object.hasOwn(property, 'value') ||
              property.enumerable !== true) refuse()
        Object.defineProperty(result, key, {
          value: copy(property.value, depth + 1),
          configurable: true, enumerable: true, writable: true,
        })
      }
      return result
    } finally {
      visiting.delete(node)
    }
  }
  return copy(value, 0)
}
