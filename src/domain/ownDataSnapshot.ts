// Local boundary for financial data supplied by direct JavaScript callers.
// Object-spread, JSON.stringify and ordinary property lookups would evaluate
// hostile getters. Copy only data descriptors into inert, bounded structures.
const MAX_DEPTH = 12
const MAX_FIELDS = 10000
const MAX_STRING_UNITS = 1024 * 1024

export function snapshotOwnFinancialData<T>(input: T): T | null {
  const seen = new Set<object>()
  let fieldsRemaining = MAX_FIELDS
  let textRemaining = MAX_STRING_UNITS

  function walk(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH || --fieldsRemaining < 0) {
      throw new Error('invalid financial evidence')
    }
    if (value === null || value === undefined ||
        typeof value === 'boolean' || typeof value === 'number') return value
    if (typeof value === 'string') {
      textRemaining -= value.length
      if (textRemaining < 0) throw new Error('invalid financial evidence')
      return value
    }
    if (typeof value !== 'object' || seen.has(value)) {
      throw new Error('invalid financial evidence')
    }
    seen.add(value)

    const prototype = Object.getPrototypeOf(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    fieldsRemaining -= keys.length
    if (fieldsRemaining < 0) throw new Error('invalid financial evidence')

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new Error('invalid financial evidence')
      const length = descriptors.length
      if (!length || !Object.hasOwn(length, 'value') ||
          !Number.isSafeInteger(length.value) ||
          length.value > 4096 || keys.length !== length.value + 1) {
        throw new Error('invalid financial evidence')
      }
      const copy: unknown[] = []
      for (let index = 0; index < length.value; index++) {
        const element = Object.getOwnPropertyDescriptor(descriptors, String(index))?.value
        if (!element || !Object.hasOwn(element, 'value')) {
          throw new Error('invalid financial evidence')
        }
        copy.push(walk(element.value, depth + 1))
      }
      return copy
    }

    if (prototype !== null && prototype !== Object.prototype) {
      throw new Error('invalid financial evidence')
    }
    const copy: Record<string, unknown> = Object.create(null)
    for (const key of keys) {
      if (typeof key !== 'string') throw new Error('invalid financial evidence')
      const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)?.value
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('invalid financial evidence')
      }
      copy[key] = walk(descriptor.value, depth + 1)
    }
    return copy
  }

  try {
    const snapshot = walk(input, 0)
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return null
    }
    return snapshot as T
  } catch {
    return null
  }
}
