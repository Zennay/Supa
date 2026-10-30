import { createHash } from 'node:crypto'
import { types as nodeTypes } from 'node:util'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'

/**
 * A direct approved capture must not rely on getter/proxy fields that can
 * mutate permissionGate/grant/source after permission checks and before
 * invoking the caller-injected HTTP transport. Snapshot ALL nested inputs
 * with own data descriptors first; never execute getter code.
 */
function inertCaptureValue(value, depth = 0) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new Error('Authorized capture requires inert permission data')
    }
    return value
  }
  if (depth > 10 || nodeTypes.isProxy(value)) {
    throw new Error('Authorized capture requires inert permission data')
  }
  const array = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype
    : proto !== Object.prototype && proto !== null) {
    throw new Error('Authorized capture requires inert permission data')
  }
  const desc = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(desc).some(k => typeof k !== 'string')) {
    throw new Error('Authorized capture requires inert permission data')
  }
  if (array) {
    const length = desc.length
    if (!Object.hasOwn(length, 'value') || length.value > 256 ||
        Reflect.ownKeys(desc).length !== length.value + 1) {
      throw new Error('Authorized capture requires inert permission data')
    }
    const copy = []
    for (let i = 0; i < length.value; i++) {
      if (!desc[i] || !Object.hasOwn(desc[i], 'value')) {
        throw new Error('Authorized capture requires inert permission data')
      }
      copy.push(inertCaptureValue(desc[i].value, depth + 1))
    }
    return copy
  }
  if (Object.keys(desc).length > 128) {
    throw new Error('Authorized capture requires inert permission data')
  }
  const copy = Object.create(null)
  for (const [key, descriptor] of Object.entries(desc)) {
    if (key === '__proto__' || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('Authorized capture requires inert permission data')
    }
    copy[key] = inertCaptureValue(descriptor.value, depth + 1)
  }
  return copy
}

function inertCaptureRequest(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      nodeTypes.isProxy(options)) {
    throw new Error('Authorized capture requires inert permission data')
  }
  const desc = Object.getOwnPropertyDescriptors(options)
  const allowed = ['source', 'permissionGate', 'grant', 'fetchFn', 'capturedAt']
  if (Reflect.ownKeys(desc).some(key => !allowed.includes(key))) {
    throw new Error('Authorized capture requires inert permission data')
  }
  const result = {}
  for (const key of allowed) {
    if (!desc[key]) continue
    if (!Object.hasOwn(desc[key], 'value')) {
      throw new Error('Authorized capture requires inert permission data')
    }
    result[key] = key === 'fetchFn' ? desc[key].value : inertCaptureValue(desc[key].value)
  }
  return result
}

// Reusable authorized capture transport. No live command automatically runs
// this module; caller supplies explicit permission record and fetch capability.
// It never proxies, authenticates, follows redirects or rotates on rate limits.
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
  // Product routes must identify an item, never an empty catalog root.
  const route = config[source.kind].some(prefix =>
    (source.kind !== 'product' && target.pathname === prefix) || (
      prefix.endsWith('/') && target.pathname.startsWith(prefix) &&
      (source.kind !== 'product' || (
        target.pathname.length > prefix.length &&
        target.pathname[prefix.length] !== '/'
      ))
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
  } catch (error) {
    // Cancel the underlying response stream on size or read failure. Merely
    // releasing a reader lock can leave a remote download running unseen.
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  if (bytes === 0) throw new Error('Empty HTML capture refused')
  // Undecompressed identity transfer has one authoritative byte count.
  // A short or overlong 200 response must never become SHA-pinned evidence.
  // Fetch commonly decodes gzip/br while retaining the wire Content-Length:
  // in that case the decoded HTML bytes cannot be compared to wire length.
  const encoding = response.headers?.get?.('content-encoding')
  if ((!encoding || encoding.toLowerCase() === 'identity') &&
      declared !== null && declared !== undefined &&
      Number(declared) !== bytes) {
    throw new Error('Incomplete HTML capture: declared length mismatch')
  }
  const all = Buffer.concat(chunks)
  const html = new TextDecoder('utf-8', { fatal: true }).decode(all)
  return { html, bytes, sha256: createHash('sha256').update(all).digest('hex') }
}

export async function captureApprovedRetailerPage(options = {}) {
  // Check ALL authorization records for accessors and unsafe aliases before
  // even checking whether an external network transport was provided.
  const { source, permissionGate, grant, fetchFn, capturedAt } =
    inertCaptureRequest(options)
  // Fail closed without injection: there is no implicit network capability,
  // scheduler, scraping of unapproved domains or free-proxy fallback.
  if (typeof fetchFn !== 'function') throw new Error('Approved fetch transport required')
  const target = checkedTarget(source)
  permittedForCapture(permissionGate, source, grant, target)
  const timestamp = capturedAt ?? new Date().toISOString()
  // Date.parse normalizes impossible Gregorian dates: retain the exact
  // civil UTC source event and refuse before invoking any transport.
  const timestampMs = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN
  if (typeof timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
      !Number.isFinite(timestampMs) ||
      new Date(timestampMs).toISOString() !== timestamp ||
      timestampMs > Date.now() + 60_000) {
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
