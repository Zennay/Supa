/**
 * Private, offline and input-budgeted entrypoint to the historical PLUS/Deka
 * universal catalog. The existing direct catalog has independently reported
 * caller boundaries (#3188, #3216); this additive entrypoint provides a safe
 * composition route WITHOUT editing another worker's catalog source.
 *
 * The budget covers ALL caller-owned primitive fields, including keys and
 * otherwise ignored metadata, not just fields used in catalog output.
 * It never makes real retailer requests or authorizes current prices.
 */
import { types as nodeTypes } from 'node:util'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'

const FAIL_MESSAGE = 'Private offline catalog input refused'
const fail = () => { throw new Error(FAIL_MESSAGE) }
export const PRIVATE_CATALOG_BUDGET = Object.freeze({
  perStringUtf8Bytes: 1_048_576,
  totalPrimitiveUtf8Bytes: 2_097_152,
  maxDepth: 32,
  maxNodes: 50_000,
  maxArrayLength: 10_000,
  maxObjectProperties: 2_048,
})

const canonicalIndex = key => /^(?:0|[1-9]\d*)$/.test(key)

/**
 * Detaches plain JSON-like caller input before validation and charges a strict
 * aggregate UTF-8 budget. Native Proxy detection precedes ALL reflection, so
 * caller traps and revoked Proxies never run. No caller-supplied coercion.
 */
export function snapshotBoundedPrivateCatalogInput(root) {
  const { perStringUtf8Bytes, totalPrimitiveUtf8Bytes,
    maxDepth, maxNodes, maxArrayLength, maxObjectProperties } = PRIVATE_CATALOG_BUDGET
  let spent = 0
  let nodes = 0
  const seen = new WeakMap()
  const active = new WeakSet()
  function charge(value) {
    if (value.length > perStringUtf8Bytes) fail()
    const bytes = Buffer.byteLength(value, 'utf8')
    if (bytes > perStringUtf8Bytes || bytes > totalPrimitiveUtf8Bytes - spent) fail()
    spent += bytes
  }
  function copy(value, depth) {
    if (++nodes > maxNodes || depth > maxDepth) fail()
    if (value === null) return null
    if (typeof value === 'string') {
      charge(value)
      return value
    }
    if (typeof value === 'boolean') {
      if (++spent > totalPrimitiveUtf8Bytes) fail()
      return value
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (spent += 8) > totalPrimitiveUtf8Bytes) fail()
      return value
    }
    if (typeof value !== 'object' || nodeTypes.isProxy(value)) fail()
    if (active.has(value)) fail()
    if (seen.has(value)) return seen.get(value)

    const array = Array.isArray(value)
    const proto = Object.getPrototypeOf(value)
    if (array ? proto !== Array.prototype :
      proto !== Object.prototype && proto !== null) fail()
    const lengthDescriptor = array
      ? Object.getOwnPropertyDescriptor(value, 'length') : null
    const length = lengthDescriptor?.value
    if (array && (!Number.isSafeInteger(length) ||
      length < 0 || length > maxArrayLength)) fail()
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.some(key => typeof key !== 'string') ||
      (array ? keys.length !== length + 1 : keys.length > maxObjectProperties)) fail()
    if (array && (keys.some(key => key !== 'length' &&
        (!canonicalIndex(key) || Number(key) >= length)) ||
        !Object.hasOwn(lengthDescriptor, 'value'))) fail()

    const out = array ? new Array(length) : Object.create(proto)
    seen.set(value, out)
    active.add(value)
    for (const key of keys) {
      if (array && key === 'length') continue
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail()
      if (array && !canonicalIndex(key)) fail()
      const descriptor = descriptors[key]
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail()
      charge(key)
      Object.defineProperty(out, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true, configurable: true, writable: true,
      })
    }
    if (array && keys.length !== length + 1) fail()
    active.delete(value)
    return out
  }

  const pinned = copy(root, 0)
  const frozen = new WeakSet()
  function freeze(value) {
    if (!value || typeof value !== 'object' || frozen.has(value)) return
    frozen.add(value)
    for (const key of Object.keys(value)) freeze(value[key])
    Object.freeze(value)
  }
  freeze(pinned)
  return pinned
}

/**
 * Private historical capture registry. Output remains explicitly non-public;
 * permission and physical source validity checks still belong to canonical
 * adapter and catalog validation. This is NOT a replacement source licence.
 */
export function buildBudgetedPrivateRetailerCatalog(batch) {
  const pinned = snapshotBoundedPrivateCatalogInput(batch)

  // Composition safety until the separately owned direct universal catalog
  // URL-query fix (#3209 / #3210) is integrated. URLSearchParams decodes
  // %-escaped names but its .has('access_token') is case-sensitive: refuse
  // every ASCII-case spelling of a credential marker before passing the
  // immutable historical captures to the canonical catalog. Never log URLs.
  if (Array.isArray(pinned?.results)) {
    for (const result of pinned.results) {
      if (!Array.isArray(result?.observations)) continue
      for (const observation of result.observations) {
        const sourceUrl = observation?.provenance?.url
        if (typeof sourceUrl !== 'string') continue
        let source
        try { source = new URL(sourceUrl) } catch { fail() }
        for (const name of source.searchParams.keys()) {
          if (name.toLowerCase() === 'access_token') fail()
        }
      }
    }
  }
  const catalog = buildUniversalRetailerCatalog(pinned)
  if (catalog.status !== 'private-review-only' ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false ||
      !Array.isArray(catalog.products)) fail()
  return catalog
}
