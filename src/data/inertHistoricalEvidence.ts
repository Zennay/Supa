/**
 * In-process boundary for already archived, JSON-shaped retailer observations.
 *
 * CLI JSON.parse produces inert objects, but exported browser/Node entrypoints
 * can be called with executable getters and inherited values. Before touching
 * source URL, capture clock, cards or Nuxt product payload, make an isolated
 * own-data copy. This is NOT a permission grant or a substitute for the
 * independent SHA, source-kind and timestamp checks in each parser.
 */
const MAX_DEPTH = 32
const MAX_NODES = 50_000
const MAX_ARRAY_LENGTH = 10_000
const MAX_OBJECT_PROPERTIES = 2_048
const MAX_STRING_LENGTH = 100_000

const arrayIndex = /^(?:0|[1-9]\d*)$/

export function snapshotInertHistoricalEvidence<T extends object>(
  candidate: T,
): T | null {
  const seen = new WeakSet<object>()
  let nodes = 0

  function copy(value: unknown, depth: number): unknown {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new Error('unbounded retailer evidence')
    }

    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) throw new Error('unbounded string')
      return value
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('non-JSON number')
      return value
    }
    if (typeof value !== 'object' || seen.has(value)) {
      throw new Error('non-inert retailer evidence')
    }
    seen.add(value)

    const isArray = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (isArray
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
    ) {
      throw new Error('custom prototype in retailer evidence')
    }

    // Accessors are inspected, never invoked. Snapshotting every descendant
    // ensures a later parser cannot read a hidden getter in a card/offer.
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.some((key) => typeof key !== 'string')) {
      throw new Error('symbol key in JSON evidence')
    }

    if (isArray) {
      const length = descriptors.length?.value
      if (!Number.isSafeInteger(length) || length < 0 ||
          length > MAX_ARRAY_LENGTH || keys.length !== length + 1) {
        throw new Error('non-JSON array shape')
      }
      const result: unknown[] = []
      for (let index = 0; index < length; index++) {
        const key = String(index)
        const descriptor = descriptors[key]
        if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true) {
          throw new Error('sparse or executable retailer array')
        }
        result.push(copy(descriptor.value, depth + 1))
      }
      if (keys.some((key) => key !== 'length' &&
          (typeof key !== 'string' || !arrayIndex.test(key) ||
            Number(key) >= length))) {
        throw new Error('extra array property')
      }
      return result
    }

    if (keys.length > MAX_OBJECT_PROPERTIES) {
      throw new Error('unbounded retailer object')
    }
    const result = Object.create(prototype) as Record<string, unknown>
    for (const key of keys) {
      const descriptor = descriptors[key as string]
      if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
          descriptor.enumerable !== true) {
        throw new Error('executable retailer property')
      }
      Object.defineProperty(result, key, {
        enumerable: true, writable: true, configurable: true,
        value: copy(descriptor.value, depth + 1),
      })
    }
    return result
  }

  try {
    const result = copy(candidate, 0)
    return result && typeof result === 'object' && !Array.isArray(result)
      ? result as T : null
  } catch {
    // Untrusted in-process objects cannot escape diagnostic details or be
    // promoted into price observations. Proxies may invoke JS descriptor
    // traps during inspection; this boundary guarantees no accessor reads.
    return null
  }
}
