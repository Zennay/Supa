import { types as nodeTypes } from 'node:util'
import { buildUniversalRetailerCatalog } from '../../scripts/retailer-universal-catalog.mjs'

// Reference-only QA preflight for exported direct JS catalog boundary.
// NOT wired into product, deployment, public price access or CLI.
const MAX_DEPTH = 40
const MAX_NODES = 50000
const MAX_KEYS = 4096
const MAX_ARRAY_ITEMS = 16384
const refuse = () => { throw new Error('Untrusted direct catalog JavaScript input') }

export function pinInertCatalogReference(input) {
  const budget = { nodes: 0 }
  function pin(value, depth) {
    if (value === undefined || value === null ||
        typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value !== 'object' || nodeTypes.isProxy(value) ||
        depth > MAX_DEPTH || ++budget.nodes > MAX_NODES) refuse()
    const proto = Object.getPrototypeOf(value)
    if (Array.isArray(value)) {
      if (proto !== Array.prototype) refuse()
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const own = Reflect.ownKeys(descriptors)
      const n = descriptors.length?.value
      if (!Number.isSafeInteger(n) || n > MAX_ARRAY_ITEMS ||
          own.length !== n + 1) refuse()
      const copy = []
      for (let index = 0; index < n; index++) {
        const d = descriptors[index]
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) refuse()
        copy.push(pin(d.value, depth + 1))
      }
      return Object.freeze(copy)
    }
    if (proto !== Object.prototype && proto !== null) refuse()
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length > MAX_KEYS) refuse()
    const copy = {}
    for (const key of keys) {
      const d = descriptors[key]
      if (typeof key !== 'string' || !d || !Object.hasOwn(d, 'value') ||
          !d.enumerable) refuse()
      Object.defineProperty(copy, key, {
        enumerable: true,
        configurable: false,
        writable: false,
        value: pin(d.value, depth + 1),
      })
    }
    return Object.freeze(copy)
  }
  return pin(input, 0)
}

export function buildQaCatalogWithInertReference(batch) {
  return buildUniversalRetailerCatalog(pinInertCatalogReference(batch))
}
