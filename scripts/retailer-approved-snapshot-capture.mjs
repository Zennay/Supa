import { createHash } from 'node:crypto'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'

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

export async function captureApprovedRetailerPage({
  source, permissionGate, grant, fetchFn, capturedAt,
} = {}) {
  // Fail closed without injection: there is no implicit network capability,
  // scheduler, scraping of unapproved domains or free-proxy fallback.
  if (typeof fetchFn !== 'function') throw new Error('Approved fetch transport required')
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
