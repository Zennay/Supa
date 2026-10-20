// Protect direct offline HTML-renderer calls from accessor-backed reports.
// A JSON-derived comparison is a bounded plain-data tree: copy every value
// through its *own descriptor*, before validating prices or building markup.
// Never use JSON.stringify, spread, Object.assign, or property reads on the
// untrusted tree: those can execute getters or trust inherited amounts.
const FAILURE = 'M3 private comparison requires plain own-data evidence'
const MAX_DEPTH = 16
const MAX_FIELDS = 12000
const MAX_TEXT_UNITS = 1024 * 1024

export function snapshotPrivateM3Comparison(input) {
  const visited = new Set()
  let remainingFields = MAX_FIELDS
  let remainingText = MAX_TEXT_UNITS

  function walk(value, depth) {
    if (depth > MAX_DEPTH || --remainingFields < 0) throw new Error(FAILURE)
    if (value === null || value === undefined ||
        typeof value === 'boolean' || typeof value === 'number') {
      return value
    }
    if (typeof value === 'string') {
      remainingText -= value.length
      if (remainingText < 0) throw new Error(FAILURE)
      return value
    }
    if (typeof value !== 'object' || visited.has(value)) {
      throw new Error(FAILURE)
    }
    visited.add(value)

    // A Proxy may trap introspection; reject any failure without embedding
    // thrown private data or exception messages in the public CLI output.
    const prototype = Object.getPrototypeOf(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    remainingFields -= keys.length
    if (remainingFields < 0) throw new Error(FAILURE)

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new Error(FAILURE)
      const lengthDescriptor = descriptors.length
      if (!lengthDescriptor || !('value' in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value > 4096) throw new Error(FAILURE)
      const length = lengthDescriptor.value
      if (keys.length !== length + 1) throw new Error(FAILURE)
      const copy = []
      for (let index = 0; index < length; index++) {
        const entry = descriptors[String(index)]
        if (!entry || !('value' in entry)) throw new Error(FAILURE)
        copy.push(walk(entry.value, depth + 1))
      }
      return copy
    }

    if (prototype !== null && prototype !== Object.prototype) {
      throw new Error(FAILURE)
    }
    const copy = Object.create(null)
    for (const key of keys) {
      if (typeof key !== 'string') throw new Error(FAILURE)
      const entry = Object.getOwnPropertyDescriptor(descriptors, key)?.value
      if (!entry || !('value' in entry)) throw new Error(FAILURE)
      copy[key] = walk(entry.value, depth + 1)
    }
    return copy
  }

  try {
    const copy = walk(input, 0)
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
      throw new Error(FAILURE)
    }
    return copy
  } catch {
    throw new Error(FAILURE)
  }
}
