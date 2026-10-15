import { createHash } from 'node:crypto'
import { types as utilTypes } from 'node:util'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'

// Reusable authorized capture transport. No live command automatically runs
// this module; caller supplies explicit permission record and fetch capability.
// It never proxies, authenticates, follows redirects or rotates on rate limits.

/**
 * Caller-provided grant/source/rights records are NOT trusted just because
 * their fields currently look permissible. Read only own data descriptors and
 * pin a detached plain-data snapshot BEFORE rights evaluation or transport.
 * In particular never evaluate a grant getter after checking a permission
 * status: it could revoke that status as a side effect.
 */
function requireOwnData(record, key, optional = false) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      utilTypes.isProxy(record) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(record))) {
    throw new Error('Immutable capture scope record required')
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor) {
    if (optional) return undefined
    throw new Error('Immutable capture scope field required')
  }
  if (!Object.hasOwn(descriptor, 'value')) {
    throw new Error('Immutable capture scope fields cannot be accessors')
  }
  return descriptor.value
}

function snapshotScopeData(value, depth = 0, budget = { entries: 0 }, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' ||
      typeof value === 'number' || typeof value === 'boolean' ||
      typeof value === 'undefined') return value
  if (typeof value !== 'object' || utilTypes.isProxy(value) || depth > 7 ||
      seen.has(value)) {
    throw new Error('Immutable capture permission data required')
  }
  const isArray = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (isArray ? prototype !== Array.prototype :
    prototype !== Object.prototype && prototype !== null) {
    throw new Error('Immutable capture permission data must be plain')
  }
  seen.add(value)
  const keys = Reflect.ownKeys(value)
  budget.entries += keys.length
  if (keys.length > 256 || budget.entries > 768) {
    throw new Error('Capture permission data exceeds bounds')
  }
  const copy = isArray ? [] : Object.create(null)
  for (const key of keys) {
    if (isArray && key === 'length') continue
    if (typeof key !== 'string' || key === '__proto__' ||
        (isArray && !/^(?:0|[1-9][0-9]*)$/.test(key))) {
      throw new Error('Capture permission data contains unsupported keys')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('Immutable capture permission data cannot have accessors')
    }
    const pinned = snapshotScopeData(descriptor.value, depth + 1, budget, seen)
    Object.defineProperty(copy, key, {
      value: pinned, enumerable: true, configurable: true, writable: true,
    })
  }
  if (isArray && (keys.length - 1 !== value.length ||
      Object.keys(copy).length !== value.length)) {
    throw new Error('Sparse capture permission data is not accepted')
  }
  seen.delete(value)
  return copy
}

const MAX_BODY_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 10000
const ROUTES = Object.freeze({
  plus: {
    host: 'www.plus.nl',
    product: ['/product/'],
    catalog: ['/producten', '/producten/'],
    offers: ['/aanbiedingen', '/aanbiedingen/'],
  },
  dekamarkt: {
    host: 'www.dekamarkt.nl',
    product: ['/producten/'],
    catalog: ['/producten/'],
    offers: ['/aanbiedingen', '/aanbiedingen/'],
  },
})

function checkedTarget(source) {
  if (!source || typeof source !== 'object') throw new Error('Missing source')
  const config = Object.hasOwn(ROUTES, source.supermarket) ? ROUTES[source.supermarket] : null
  if (!config || !Object.hasOwn(config, source.kind)) {
    throw new Error('Retailer or capture type has no explicit adapter allowlist')
  }
  let target
  try { target = new URL(source.url) } catch { throw new Error('Malformed retailer source URL') }
  const route = config[source.kind].some(prefix =>
    target.pathname === prefix || (
      prefix.endsWith('/') && target.pathname.startsWith(prefix)
    ))
  if (target.protocol !== 'https:' || target.hostname !== config.host ||
      target.port || target.username || target.password ||
      target.search || target.hash || target.href !== source.url || !route) {
    throw new Error('Retailer source outside exact approved HTTPS route')
  }
  return target.href
}

function permittedForCapture(gate, source, grant, target) {
  // The canonical audited source gate enforces both known retailers, evidence
  // categories and fail-closed productionEnabled statuses.
  evaluateSourcePermissionGate(gate)
  const retailer = gate.sources.find(x => x.supermarket === source.supermarket)
  if (!retailer || retailer.permissionStatus !== 'permitted' ||
      retailer.productionEnabled !== true ||
      !retailer.evidence.some(e => ['written_permission', 'official_license'].includes(e.kind))) {
    throw new Error('Explicit retailer source permission required')
  }
  if (!grant || grant.supermarket !== source.supermarket ||
      grant.kind !== source.kind ||
      grant.sourceUrl !== target || grant.reviewed !== true) {
    // Rechecked explicitly below; this expression must never authorize a
    // missing or invented scope via falsy coercion.
    throw new Error('Approved one-URL capture scope required')
  }
  if (grant.termsReviewed !== true || grant.robotsReviewed !== true ||
      grant.noAntiBotBypass !== true) {
    throw new Error('Missing documented robots/terms safe-use review')
  }
}

async function collectBoundedBody(response) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    throw new Error('Missing streaming HTML body')
  }
  const contentType = response.headers?.get?.('content-type') || ''
  if (!/^text\/html(?:\s*;|$)/i.test(contentType.trim())) {
    throw new Error('Source did not return HTML')
  }
  const declared = response.headers?.get?.('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new Error('Declared snapshot exceeds size budget')
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('Invalid HTML chunk')
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) throw new Error('Snapshot exceeds size budget')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const all = Buffer.concat(chunks)
  const html = new TextDecoder('utf-8', { fatal: true }).decode(all)
  return { html, bytes, sha256: createHash('sha256').update(all).digest('hex') }
}

export async function captureApprovedRetailerPage(options = {}) {
  // Fail closed without injection. Pin the ENTIRE authorization envelope first
  // so neither source/grant accessors nor mutable gate arrays can change its
  // meaning between the rights check and the one permitted transport call.
  const fetchFn = requireOwnData(options, 'fetchFn', true)
  if (typeof fetchFn !== 'function' || utilTypes.isProxy(fetchFn)) {
    throw new Error('Approved fetch transport required')
  }
  const source = snapshotScopeData(requireOwnData(options, 'source'))
  const grant = snapshotScopeData(requireOwnData(options, 'grant'))
  const permissionGate = snapshotScopeData(requireOwnData(options, 'permissionGate'))
  const capturedAt = requireOwnData(options, 'capturedAt', true)
  const target = checkedTarget(source)
  permittedForCapture(permissionGate, source, grant, target)
  const timestamp = capturedAt ?? new Date().toISOString()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) ||
      Date.parse(timestamp) > Date.now() + 60_000) {
    throw new Error('Invalid source capture clock')
  }
  const response = await fetchFn(target, {
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      'accept': 'text/html',
      'user-agent': 'SUPA-authorized-source-review/0.1',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response?.status === 403 || response?.status === 429) {
    throw new Error('Retailer refused or rate-limited capture; no retry/rotation')
  }
  if (response?.status !== 200 || response?.ok !== true ||
      (response.url && response.url !== target)) {
    throw new Error('Retailer capture failed or redirected')
  }
  const body = await collectBoundedBody(response)
  return {
    mode: 'authorized-one-page-capture-needs-review',
    source: {
      retailerId: source.supermarket,
      kind: source.kind,
      url: target,
      capturedAt: timestamp,
      sha256: body.sha256,
    },
    bytes: body.bytes,
    html: body.html,
    permissionVerifiedForThisRequest: true,
    normalized: false,
    readyForIngestion: false,
    published: false,
  }
}
