import { decodeExactRetailerHtmlBytes } from './retailer-private-html-byte-identity.mjs'
import { createHash } from 'node:crypto'
import { types as nodeTypes } from 'node:util'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'
import { scanOfflineRetailerMarkup } from './retailer-offline-structural-scan.mjs'
import { ambiguousRetailerRoute, isAllowedM1RetailerSourcePath } from './retailer-source-route-safety.mjs'

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
  plus: {host:'www.plus.nl'},
  dekamarkt: {host:'www.dekamarkt.nl'},
})

function checkedTarget(source) {
  if (!source || typeof source !== 'object') throw new Error('Missing source')
  const config = Object.hasOwn(ROUTES, source.supermarket) ? ROUTES[source.supermarket] : null
  if (!config || !['product','catalog','offers'].includes(source.kind)) {
    throw new Error('Retailer or capture type has no explicit adapter allowlist')
  }
  let target
  try { target = new URL(source.url) } catch { throw new Error('Malformed retailer source URL') }
  // Preserve explicit error and reject before any transport is invoked.
  if (ambiguousRetailerRoute(target.pathname))
    throw new Error('Ambiguous retailer capture route')
  const route=isAllowedM1RetailerSourcePath(
    source.supermarket,source.kind,target.pathname)
  if (target.protocol !== 'https:' || target.hostname !== config.host ||
      target.port || target.username || target.password ||
      target.search || target.hash || target.href !== source.url || !route) {
    throw new Error('Retailer source outside exact approved HTTPS route')
  }
  return target.href
}

function assertDocumentSourceIdentity(html, target) {
  // The HTTP 200 destination is not sufficient source provenance: HTML may
  // navigate the browser or rebase relative links to a different storefront.
  // Use the same inert offline HTML tokenizer as selector and price replay.
  const document = scanOfflineRetailerMarkup(html)
  if (document.hasMetaRefresh) throw new Error('Retailer HTML navigation refused')
  if (document.hasMetaNoStore || document.hasMetaNoArchive) throw new Error('Retailer HTML disallows snapshot archival')
  if (document.hasConflictingCharset) throw new Error('Untrusted retailer HTML charset')
  const expected = new URL(target)
  for (const href of document.baseHrefs) {
    // The browser resolves HTML character references before interpreting
    // href. Never validate their undecoded source text as a safe URL.
    if (typeof href !== 'string' || !href || href.length > 2048 || (href.includes('&') || ambiguousRetailerRoute(href))) {
      throw new Error('Untrusted HTML base URL')
    }
    let destination
    try { destination = new URL(href, target) }
    catch { throw new Error('Untrusted HTML base URL') }
    if (destination.origin !== expected.origin || destination.username ||
        destination.password || destination.protocol !== 'https:') {
      throw new Error('Untrusted HTML base URL')
    }
  }
  for (const href of document.canonicalHrefs) {
    if (typeof href !== 'string' || !href || href.length > 2048 || (href.includes('&') || ambiguousRetailerRoute(href))) {
      throw new Error('Untrusted HTML canonical source URL')
    }
    let destination
    try { destination = new URL(href, target) }
    catch { throw new Error('Untrusted HTML canonical source URL') }
    // A canonical for another product cannot prove the requested SKU's
    // provenance, even when both URLs share the retailer host.
    const path = p => p.replace(/\/$/, '') || '/'
    if (destination.origin !== expected.origin || destination.username ||
        destination.password || destination.search || destination.hash ||
        path(destination.pathname) !== path(expected.pathname)) {
      throw new Error('Untrusted HTML canonical source URL')
    }
  }
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

function sameRetailerContentLocation(raw, source) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048 ||
      raw.includes('&') || ambiguousRetailerRoute(raw))
    return false
  let claimed
  try { claimed = new URL(raw, source) } catch { return false }
  const expected = new URL(source)
  const path = value => value.replace(/\/$/, '') || '/'
  return claimed.origin === expected.origin && claimed.username === '' &&
    claimed.password === '' && !claimed.search && !claimed.hash &&
    path(claimed.pathname) === path(expected.pathname)
}

function sameRetailerCanonicalLink(raw, source) {
  if (raw == null) return true
  if (typeof raw !== 'string' || raw.length > 8192) return false
  // A Link header may include ordinary preload hints and a canonical link.
  // Never infer/override a canonical source from an unparseable relation.
  for (const item of raw.split(/,\s*(?=<)/)) {
    const relation = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;,\s]+))/ig
    let match
    let canonical = false
    while ((match = relation.exec(item)) !== null) {
      const relations = (match[1] ?? match[2] ?? match[3]).split(/[ \t]+/)
      if (relations.some(x => x.toLowerCase() === 'canonical')) canonical = true
    }
    if (!canonical) {
      // Malformed canonical declarations must not escape the parser.
      if (/\brel\s*=.*canonical/i.test(item)) return false
      continue
    }
    const target = /^\s*<([^<>]{1,2048})>/.exec(item)?.[1]
    if (!target || !sameRetailerContentLocation(target, source)) return false
  }
  return true
}

function sourceHttpFreshness(headers) {
  // Captured-at is a transport observation, not a guarantee that a CDN's
  // HTTP representation is current. Reject explicitly stale source evidence
  // instead of giving yesterday's cached prices a fresh acquisition clock.
  const age = headers?.get?.('age')
  const dated = headers?.get?.('date')
  const maxAgeSeconds = 24 * 60 * 60
  const now = Date.now()
  if (age !== null && age !== undefined) {
    const value = age.trim()
    if (!/^(?:0|[1-9]\d{0,9})$/.test(value) ||
        Number(value) >= maxAgeSeconds) return false
  }
  if (dated !== null && dated !== undefined) {
    const timestamp = Date.parse(dated)
    // HTTP Date is an IMF-fixdate in GMT with an authentic weekday.
    // Date.parse also accepts ISO aliases, arbitrary timezones and wrong
    // weekday names, none of which prove a canonical HTTP source clock.
    if (!Number.isFinite(timestamp) ||
        new Date(timestamp).toUTCString() !== dated ||
        timestamp > now + 5 * 60 * 1000 ||
        now - timestamp >= maxAgeSeconds * 1000) return false
  }
  return true
}

// Fetch delivers already-decoded bytes while HTTP Content-Length may still
// describe the compressed wire representation. Accept only a single known
// encoding token; an arbitrary/multi-valued header must not disable the
// identity byte-length integrity check.
function trustedHttpContentEncoding(headers) {
  const raw = headers?.get?.('content-encoding')
  if (raw === null || raw === undefined) return 'identity'
  if (typeof raw !== 'string') return null
  const type = raw.trim().toLowerCase()
  return ['identity', 'gzip', 'br', 'deflate'].includes(type) ? type : null
}

// RFC 9530 byte integrity is representation-specific. A decoded fetch body
// cannot prove a digest of compressed wire bytes: refuse that combination
// rather than blessing an uncheckable merchant source. This is optional only
// when the server sends no Content-Digest at all.
function parseHttpDigestDictionary(raw, fieldName) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string' || raw.length > 240) {
    throw new Error('Unsupported or ambiguous retailer ' + fieldName)
  }
  // RFC 9530 SHA-256/SHA-512 structured dictionary, strict on duplicates
  // and on any mismatched dictionary member. No silent algorithm downgrade.
  const expected = Object.create(null)
  for (const item of raw.split(',')) {
    const match = /^(sha-256|sha-512)=:([A-Za-z0-9+/]+={0,2}):$/.exec(item.trim())
    const algorithm = match?.[1], encoded = match?.[2]
    const size = algorithm === 'sha-256' ? 32 : 64
    if (!algorithm || Object.hasOwn(expected, algorithm) ||
        Buffer.from(encoded, 'base64').length !== size ||
        Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
      throw new Error('Unsupported or ambiguous retailer ' + fieldName)
    }
    expected[algorithm] = encoded
  }
  return expected
}

function checkedHttpContentDigest(headers) {
  const rawContent = headers?.get?.('content-digest')
  const rawRepresentation = headers?.get?.('repr-digest')
  if (rawContent == null && rawRepresentation == null) return null
  // The 200 response is a complete representation (ranges, alternate
  // Content-Location and redirections already rejected above). For identity
  // encoding, both RFC 9530 fields attest the exact same received bytes.
  // Fetch silently decompresses gzip/br: coded digests cannot be checked.
  if (trustedHttpContentEncoding(headers) !== 'identity') {
    throw new Error('Unsupported or ambiguous retailer ' +
      (rawRepresentation != null ? 'Repr-Digest' : 'Content-Digest'))
  }
  return [
    parseHttpDigestDictionary(rawContent, 'Content-Digest'),
    parseHttpDigestDictionary(rawRepresentation, 'Repr-Digest'),
  ].filter(value => value !== null)
}

async function collectBoundedBody(response, expectedDigest) {
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
  // A misleading declared charset can change price/name semantics downstream.
  // Only validated UTF-8 is accepted for source snapshots.
  const charsets = [...contentType.matchAll(/;\s*charset\s*=\s*['"]?([^;'",\s]+)['"]?/gi)]
  if (charsets.length > 1 || (charsets.length && !/^utf-?8$/i.test(charsets[0][1]))) {
    throw new Error('Unsupported or ambiguous retailer HTML charset')
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  let segments = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // A dishonest or stalled transport can deliver unlimited zero/tiny
      // chunks without ever exceeding the byte budget. Bound read work too.
      if (++segments > 8192) throw new Error('HTML stream segment budget exceeded')
      if (!(value instanceof Uint8Array)) throw new Error('Invalid HTML chunk')
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) throw new Error('Snapshot exceeds size budget')
      // A streaming reader may recycle a Uint8Array/backing buffer between
      // reads. Own every chunk immediately or earlier source bytes could be
      // overwritten before SHA calculation and archival.
      chunks.push(Buffer.from(value))
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
  const encoding = trustedHttpContentEncoding(response.headers)
  if (encoding === null) throw new Error('Unsupported or ambiguous retailer Content-Encoding')
  if (encoding === 'identity' &&
      declared !== null && declared !== undefined &&
      Number(declared) !== bytes) {
    throw new Error('Incomplete HTML capture: declared length mismatch')
  }
  const all = Buffer.concat(chunks)
  const digest = createHash('sha256').update(all).digest()
  if (expectedDigest !== null) {
    const sha256 = digest.toString('base64')
    const sha512 = expectedDigest.some(row => row['sha-512'])
      ? createHash('sha512').update(all).digest('base64') : null
    for (const row of expectedDigest) {
      if ((row['sha-256'] && row['sha-256'] !== sha256) ||
          (row['sha-512'] && row['sha-512'] !== sha512)) {
        throw new Error('Retailer Content-Digest mismatch')
      }
    }
  }
  const html = decodeExactRetailerHtmlBytes(all)
  return { html, bytes, sha256: digest.toString('hex') }
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
      // Prefer identity so server-provided HTTP digests describe the exact
      // bytes read by Fetch, rather than compressed wire representation.
      'accept-encoding': 'identity',
      // RFC 9530 is optional: a retailer may omit the digest entirely.
      'want-content-digest': 'sha-256=10, sha-512=9',
      'want-repr-digest': 'sha-256=10, sha-512=9',
      'user-agent': 'SUPA-authorized-source-review/0.1',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  // Rejected upstream bodies must not keep downloading after the source
  // lane refuses their status, final URL or unsafe response metadata.
  async function closeRejectedBody() {
    try { await response?.body?.cancel?.() } catch { /* fail closed */ }
  }
  if (response?.status === 403 || response?.status === 429) {
    await closeRejectedBody()
    throw new Error('Retailer refused or rate-limited capture; no retry/rotation')
  }
  if (response?.status !== 200 || response?.ok !== true ||
      (response.url && response.url !== target)) {
    await closeRejectedBody()
    throw new Error('Retailer capture failed or redirected')
  }
  // HTTP 200 can still carry a navigation or alternate representation
  // identity without a 3xx. Refuse it before reading private source bytes.
  const refresh = response.headers?.get?.('refresh')
  const contentLocation = response.headers?.get?.('content-location')
  const links = response.headers?.get?.('link')
  // An upstream may return a partial representation with HTTP 200 by
  // mistake. Never hash a ranged fragment as a complete HTML snapshot.
  const contentRange = response.headers?.get?.('content-range')
  if (contentRange != null) {
    await closeRejectedBody()
    throw new Error('Partial retailer HTML representation refused')
  }
  if ((refresh != null && refresh.trim() !== '') ||
      (contentLocation != null && !sameRetailerContentLocation(contentLocation, target)) ||
      !sameRetailerCanonicalLink(links, target)) {
    await closeRejectedBody()
    throw new Error('Retailer response navigation/source identity refused')
  }
  if (!sourceHttpFreshness(response.headers)) {
    await closeRejectedBody()
    throw new Error('Stale or malformed retailer HTTP representation refused')
  }
  // A 200 HTML body is not necessarily an archivable page. Honor an explicit
  // no-store instruction and refuse download attachments before persisting
  // source evidence. Private cache directives alone are compatible with the
  // protected local 0600 operator archive; they are not source permissions.
  const cacheControl = response.headers?.get?.('cache-control') || ''
  const disposition = response.headers?.get?.('content-disposition') || ''
  const robotsHeader = response.headers?.get?.('x-robots-tag') || ''
  // Source archive opt-outs may be conveyed as HTTP headers rather than
  // HTML meta. Refuse before reading a response body or storing a SHA.
  if (/(?:^|[,;])\s*no-store(?:\s*[;,]|\s*$)/i.test(cacheControl) ||
      /(?:^|[,:;\s])noarchive(?=$|[,:;\s])/i.test(robotsHeader) ||
      /^\s*attachment(?:\s*;|\s*$)/i.test(disposition)) {
    await closeRejectedBody()
    throw new Error('Retailer HTML response disallows snapshot archival')
  }
  // Refuse unknown or stacked transfer encodings before reading a body:
  // otherwise an invented Content-Encoding could conceal a truncated 200.
  if (trustedHttpContentEncoding(response.headers) === null) {
    await closeRejectedBody()
    throw new Error('Unsupported or ambiguous retailer Content-Encoding')
  }
  let expectedDigest
  try { expectedDigest = checkedHttpContentDigest(response.headers) }
  catch (error) { await closeRejectedBody(); throw error }
  let body
  try { body = await collectBoundedBody(response, expectedDigest) }
  catch (error) {
    await closeRejectedBody()
    throw error
  }
  assertDocumentSourceIdentity(body.html, target)
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
