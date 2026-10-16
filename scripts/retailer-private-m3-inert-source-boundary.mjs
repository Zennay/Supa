/**
 * Product-core trust boundary for the exported *in-process* private M3 API.
 * Callers may hand us active JavaScript objects despite CLI inputs being JSON.
 *
 * Copy only own inert data descriptors into a new deeply immutable graph,
 * BEFORE any canonical retailer, provenance, rights or catalog code sees it.
 * This does not replace the separate source-permission and six-kind checks.
 */
import { types as nodeTypes } from 'node:util'

const fail = () => { throw new Error('Private M3 historical source snapshot refused') }
const LIMITS = Object.freeze({
  depth: 32, nodes: 50_000, arrayLength: 10_000,
  properties: 2_048, stringLength: 100_000,
})
const index = key => /^(?:0|[1-9]\d*)$/.test(key)

function snapshotGraph(root) {
  let nodes = 0
  const seen = new WeakMap()
  const active = new WeakSet()

  function copy(value, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail()
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.length > LIMITS.stringLength) fail()
      return value
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail()
      return value
    }
    if (typeof value !== 'object' || nodeTypes.isProxy(value)) fail()
    if (active.has(value)) fail()
    if (seen.has(value)) return seen.get(value)

    // Inspect an inert own ARRAY LENGTH descriptor first: no getters, no
    // user-owned property access and no accidental giant array enumeration.
    const isArray = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (isArray ? prototype !== Array.prototype :
      prototype !== Object.prototype && prototype !== null) fail()
    const lengthDescriptor = isArray
      ? Object.getOwnPropertyDescriptor(value, 'length') : null
    const length = lengthDescriptor?.value
    if (isArray && (!Number.isSafeInteger(length) ||
        length > LIMITS.arrayLength || length < 0)) fail()

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.some(key => typeof key !== 'string') ||
        (!isArray && keys.length > LIMITS.properties) ||
        (isArray && keys.length !== length + 1)) fail()
    if (isArray) {
      if (!Object.hasOwn(lengthDescriptor, 'value')) fail()
      if (keys.some(key => key !== 'length' &&
          (!index(key) || Number(key) >= length))) fail()
      for (let i = 0; i < length; i++) {
        if (!Object.hasOwn(descriptors, i) ||
            !Object.hasOwn(descriptors[i], 'value')) fail()
      }
    }

    const result = isArray ? new Array(length) : Object.create(prototype)
    active.add(value)
    seen.set(value, result)
    for (const key of keys) {
      if (isArray && key === 'length') continue
      const descriptor = descriptors[key]
      // Accessors, symbols, sparse slots and hidden non-JSON properties are
      // not valid data observations and must be rejected BEFORE read.
      if (!Object.hasOwn(descriptor, 'value') ||
          descriptor.enumerable !== true) fail()
      const cloned = copy(descriptor.value, depth + 1)
      Object.defineProperty(result, key, {
        enumerable: true, configurable: true, writable: true, value: cloned,
      })
    }
    active.delete(value)
    return result
  }

  const frozen = new WeakSet()
  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || frozen.has(value)) return
    frozen.add(value)
    // These are new copied plain objects/arrays with data values only.
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  const result = copy(root, 0)
  deepFreeze(result)
  return result
}

/**
 * A raw reviewed-batch boundary only: no licensing, time freshness, source
 * or price claims. Full canonical validation still occurs *after* snapshot.
 */
export function snapshotInertPrivateM3Sources(permissionGate, batch) {
  const copy = snapshotGraph({ permissionGate, batch })
  if (!copy.permissionGate || !copy.batch ||
      !Array.isArray(copy.batch.results) ||
      copy.batch.results.length < 6 || copy.batch.results.length > 32) fail()
  return copy
}
