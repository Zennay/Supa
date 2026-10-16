/**
 * Independent QA-only gate for untrusted programmatic, PRIVATE M3 catalog input.
 * NOT wired into the exported product API: issue #3188 remains open until the
 * product owner applies and verifies a fix at the actual public boundary.
 * No network, live source, retailer rights, current prices, or savings output.
 */
import { types } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const fail = () => { throw new Error('Private universal catalog QA input refused') }
const LIMITS = Object.freeze({ maxDepth: 32, maxNodes: 50000, maxObjectKeys: 4096, maxArrayLength: 16384 })

/**
 * Inspect only inert own-property DESCRIPTORS: never evaluate a caller getter,
 * Proxy trap, inherited value, symbol, cycle or coercion hook.
 * All successful output is detached, canonical private JSON and frozen.
 */
export function pinInertPrivateCatalogInput(value) {
  // Track only the ACTIVE ancestry path: duplicate references are valid JSON
  // data after individually detached copying, while actual cycles are not.
  const ancestry = new WeakSet()
  let nodes = 0
  function pin(input, depth) {
    if (++nodes > LIMITS.maxNodes || depth > LIMITS.maxDepth) fail()
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) fail()
      return input
    }
    if (!input || typeof input !== 'object' || types.isProxy(input) || ancestry.has(input)) fail()
    ancestry.add(input)
    const proto = Object.getPrototypeOf(input)
    if (Array.isArray(input)) {
      if (proto !== Array.prototype) fail()
      const descriptors = Object.getOwnPropertyDescriptors(input)
      const length = descriptors.length?.value
      if (!Number.isSafeInteger(length) || length > LIMITS.maxArrayLength ||
          Reflect.ownKeys(descriptors).length !== length + 1) fail()
      const array = []
      for (let i = 0; i < length; i++) {
        const property = descriptors[String(i)]
        if (!property || !Object.hasOwn(property, 'value') ||
            property.enumerable !== true) fail()
        array.push(pin(property.value, depth + 1))
      }
      ancestry.delete(input)
      return Object.freeze(array)
    }
    if (proto !== Object.prototype && proto !== null) fail()
    const descriptors = Object.getOwnPropertyDescriptors(input)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length > LIMITS.maxObjectKeys) fail()
    const object = Object.create(null)
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value') ||
          descriptor.enumerable !== true) fail()
      Object.defineProperty(object, key, {
        value: pin(descriptor.value, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      })
    }
    ancestry.delete(input)
    return Object.freeze(object)
  }
  return pin(value, 0)
}

function assertPrivate(report) {
  if (report?.schemaVersion !== 1 || report.status !== 'private-review-only' ||
      report.productionEnabled !== false ||
      report.publicSavingsClaimEligible !== false ||
      !Array.isArray(report.products) ||
      !Number.isSafeInteger(report.sourceCount) ||
      !Number.isSafeInteger(report.captureCount) ||
      !Number.isSafeInteger(report.productCount) ||
      report.sourceCount < 1 || report.sourceCount > 32 ||
      report.productCount !== report.products.length) fail()
  for (const product of report.products) {
    if (product.publishable !== false ||
        product.sourceRightsVerified !== false ||
        product.currentTrustedPriceCents !== null ||
        product.selectedSnapshotSha256 !== null ||
        !Array.isArray(product.captures) || product.captures.length < 1) fail()
  }
}

/**
 * Private QA-only demonstration of safe admission and aggregate-only reporting
 * while upstream product API still needs #3188's source-owned fix.
 */
export function reviewInertPrivateCatalogInput(untrusted) {
  const pinned = pinInertPrivateCatalogInput(untrusted)
  let catalog
  try {
    catalog = buildUniversalRetailerCatalog(pinned)
  } catch {
    fail()
  }
  assertPrivate(catalog)
  return Object.freeze({
    mode: 'private-inert-universal-catalog-qa',
    sources: catalog.sourceCount,
    products: catalog.productCount,
    captures: catalog.captureCount,
    conflictingProducts: catalog.conflictCount,
    historicalOnly: true,
    permissionVerified: false,
    productionEnabled: false,
    livePricesAvailable: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  })
}

export async function main(argv = process.argv.slice(2), emit = text => process.stdout.write(text)) {
  // An inert command-line boundary: no user JSON, file/URL or permission flags.
  if (types.isProxy(argv) || !Array.isArray(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) fail()
  const args = Object.getOwnPropertyDescriptors(argv)
  if (Reflect.ownKeys(args).length !== 1 || args.length.value !== 0) fail()
  const batch = await loadReviewedRepositoryFixtures()
  const aggregate = reviewInertPrivateCatalogInput(batch)
  emit(JSON.stringify(aggregate) + '\n')
  return aggregate
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private universal catalog QA input refused')
    process.exitCode = 2
  })
}
