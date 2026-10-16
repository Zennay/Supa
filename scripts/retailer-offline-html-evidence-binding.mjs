/**
 * PRIVATE offline bridge from a previously captured HTML body to the reviewed
 * PLUS/Deka evidence adapters. It does not fetch, publish, grant source rights,
 * invent a product/price, or automatically approve selector proposals.
 *
 * The structured values must literally occur inside the SHA-bound HTML page.
 * PLUS rendered listing cards are intentionally unsupported until a reviewed
 * DOM extraction contract exists; no price can be inferred from CSS guesses.
 */
import { createHash } from 'node:crypto'
import { types as nodeTypes } from 'node:util'
import { ingestReviewedEvidence } from './retailer-reviewed-ingest-engine.mjs'

const fail = () => { throw new Error('Private HTML-to-retailer evidence binding refused') }
const MAX_HTML = 2 * 1024 * 1024
const MAX_EVIDENCE = 1024 * 1024

function inert(value, seen = new WeakSet(), depth = 0, budget = { count: 0 }) {
  if (++budget.count > 30000 || depth > 40) fail()
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || nodeTypes.isProxy(value) || seen.has(value)) fail()
  seen.add(value)
  const array = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail()
  const ds = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(ds).some(key => typeof key !== 'string')) fail()
  if (array) {
    const n = ds.length?.value
    if (!Number.isSafeInteger(n) || n > 4096 || Reflect.ownKeys(ds).length !== n + 1) fail()
    const output = []
    for (let i = 0; i < n; i++) {
      if (!ds[i] || !Object.hasOwn(ds[i], 'value')) fail()
      output.push(inert(ds[i].value, seen, depth + 1, budget))
    }
    return output
  }
  if (Object.keys(ds).length > 200) fail()
  const output = Object.create(null)
  for (const [key, descriptor] of Object.entries(ds)) {
    if (key === '__proto__' || key.length > 256 || !Object.hasOwn(descriptor, 'value')) fail()
    output[key] = inert(descriptor.value, seen, depth + 1, budget)
  }
  return output
}

function uniqueJson(raw) {
  // Repeated decoded JSON keys can conceal contradictory price or identity
  // evidence. Keep this check before ordinary JSON.parse takes the last key.
  const stack = []
  for (let i = 0; i < raw.length;) {
    const c = raw[i]
    if (c === '{' || c === '[') {
      if (stack.length >= 128) fail()
      stack.push(c === '{' ? new Set() : null)
      i++
      continue
    }
    if (c === '}' || c === ']') {
      if (!stack.length) fail()
      stack.pop()
      i++
      continue
    }
    if (c !== '"') { i++; continue }
    const start = i++
    while (i < raw.length) {
      if (raw[i] === '\\') { i += 2; continue }
      if (raw[i++] === '"') break
    }
    if (i > raw.length || raw[i - 1] !== '"') fail()
    let j = i
    while (j < raw.length && /[ \n\r\t]/.test(raw[j])) j++
    if (raw[j] === ':' && stack.at(-1) instanceof Set) {
      let key
      try { key = JSON.parse(raw.slice(start, i)) } catch { fail() }
      const seen = stack.at(-1)
      if (seen.has(key)) fail()
      seen.add(key)
    }
  }
  try { return JSON.parse(raw) } catch { fail() }
}

// Only literal HTML script start-tag attributes establish JSON-LD/Nuxt
// evidence. Regex searches over the full tag can confuse an attribute value
// (e.g. data-notes="text type='application/ld+json'") with a real type.
function scriptAttributes(openTag) {
  const attrs = Object.create(null)
  const source = openTag.slice(7, -1)
  let pos = 0
  while (pos < source.length) {
    while (pos < source.length && /[\t\n\r\f ]/.test(source[pos])) pos++
    if (pos === source.length) break
    const name = /^[a-z_:][a-z0-9_:.-]*/i.exec(source.slice(pos))?.[0]
    if (!name) fail()
    pos += name.length
    const key = name.toLowerCase()
    if (Object.hasOwn(attrs, key)) fail()
    while (pos < source.length && /[\t\n\r\f ]/.test(source[pos])) pos++
    let value = null
    if (source[pos] === '=') {
      pos++
      while (pos < source.length && /[\t\n\r\f ]/.test(source[pos])) pos++
      const quote = source[pos]
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, pos + 1)
        if (close < 0) fail()
        value = source.slice(pos + 1, close)
        pos = close + 1
      } else {
        const match = /^[^\s"'<>`=]+/.exec(source.slice(pos))
        if (!match) fail()
        value = match[0]
        pos += value.length
      }
    }
    attrs[key] = value
  }
  return attrs
}

function tagEnd(html, start) {
  let quote = null
  for (let index = start + 1; index < html.length; index++) {
    const ch = html[index]
    if (quote !== null) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return index
  }
  fail()
}

function scriptsFrom(html) {
  // Skip HTML comments and complete inert/raw-text DOM regions. If nesting,
  // closing or termination is ambiguous, fail closed rather than mistake a
  // non-live script for an observed price. This is not a browser DOM parser.
  const starts = (html.match(/<!--/g) ?? []).length
  const ends = (html.match(/-->/g) ?? []).length
  if (starts !== ends) fail()
  let clean = html.replace(/<!--[\s\S]*?-->/g, '')
  if (/<plaintext\b/i.test(clean)) fail()
  for (const element of ['template', 'noscript', 'textarea', 'style',
    'title', 'xmp', 'iframe', 'svg']) {
    const open = new RegExp('<' + element + '\\b', 'gi')
    const close = new RegExp('<\\/' + element + '\\s*>', 'gi')
    if ([...clean.matchAll(open)].length !== [...clean.matchAll(close)].length) fail()
    clean = clean.replace(new RegExp('<' + element + '\\b[^>]*>[\\s\\S]*?<\\/' +
      element + '\\s*>', 'gi'), '')
    // Nested, unfinished or otherwise ambiguous inert markup is not proof.
    if (new RegExp('<\\/?' + element + '\\b', 'i').test(clean)) fail()
  }
  const found = []
  let position = 0
  while (position < clean.length) {
    const next = clean.indexOf('<', position)
    if (next < 0) break
    const end = tagEnd(clean, next)
    const openTag = clean.slice(next, end + 1)
    position = end + 1
    if (!/^<script(?:\s|>)/i.test(openTag)) continue
    const attrs = scriptAttributes(openTag)
    const closing = /<\/script\s*>/gi
    closing.lastIndex = position
    const match = closing.exec(clean)
    if (!match) fail()
    const body = clean.slice(position, match.index)
    position = closing.lastIndex
    if (found.length >= 50 || Buffer.byteLength(body, 'utf8') > MAX_EVIDENCE) fail()
    if (attrs.id === '__NUXT_DATA__' || attrs.type === 'application/ld+json') {
      found.push({ id: attrs.id ?? null, type: attrs.type ?? null, body })
    }
  }
  return found
}

function hasExactStructuredPayload(scripts, kind, expected) {
  if (expected === null || expected === undefined) return false
  let matches = 0
  for (const script of scripts) {
    if (kind === 'nuxt' ? script.id !== '__NUXT_DATA__' : script.type !== 'application/ld+json') continue
    const actual = uniqueJson(script.body)
    if (JSON.stringify(actual) === JSON.stringify(expected)) matches++
  }
  return matches === 1
}

/**
 * @param {object} captured A saved result-shaped HTML snapshot. Caller facts
 *     are UNTRUSTED; the function never treats its approval flags as a grant.
 * @param {object} reviewedEvidence a separately human-reviewed adapter record.
 * @returns {object} private-only normalized facts; never publishable data.
 */
export function bindPrivateReviewedHtmlEvidence(captured, reviewedEvidence) {
  const capture = inert(captured)
  const record = inert(reviewedEvidence)
  if (capture.mode !== 'authorized-one-page-capture-needs-review' ||
      capture.permissionVerifiedForThisRequest !== true ||
      capture.normalized !== false || capture.readyForIngestion !== false ||
      capture.published !== false ||
      typeof capture.html !== 'string' ||
      Buffer.byteLength(capture.html, 'utf8') > MAX_HTML ||
      Buffer.from(capture.html, 'utf8').toString('utf8') !== capture.html ||
      !Number.isSafeInteger(capture.bytes) || capture.bytes < 1 ||
      !capture.source || !record.source) fail()
  const bytes = Buffer.byteLength(capture.html, 'utf8')
  const sha256 = createHash('sha256').update(capture.html, 'utf8').digest('hex')
  if (bytes !== capture.bytes || capture.source.sha256 !== sha256 ||
      record.source.sha256 !== sha256 ||
      capture.source.retailerId !== record.source.supermarket ||
      capture.source.kind !== record.source.kind ||
      capture.source.url !== record.source.url ||
      capture.source.capturedAt !== record.source.capturedAt ||
      typeof record.source.id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_EVIDENCE) fail()

  const key = capture.source.retailerId + ':' + capture.source.kind
  const scripts = scriptsFrom(capture.html)
  if (key === 'plus:product') {
    if (!hasExactStructuredPayload(scripts, 'jsonld', record.jsonLd) ||
        record.browserEvidence?.renderedHtmlSha256 !== sha256) fail()
  } else if (key === 'dekamarkt:product' ||
             key === 'dekamarkt:catalog' || key === 'dekamarkt:offers') {
    if (!hasExactStructuredPayload(scripts, 'nuxt', record.nuxtPayload) ||
        record.captureEvidence?.bytes !== bytes) fail()
    if (key === 'dekamarkt:product' &&
        !hasExactStructuredPayload(scripts, 'jsonld', record.jsonLdProduct)) fail()
  } else {
    // PLUS catalog/offers need independently reviewed DOM-card linkage.
    fail()
  }

  const result = ingestReviewedEvidence(record)
  if (!result.accepted) fail()
  return {
    schemaVersion: 1,
    mode: 'private-offline-html-evidence-review',
    source: { retailerId: capture.source.retailerId, kind: capture.source.kind,
      capturedAt: capture.source.capturedAt, sha256 },
    verifiedHtmlBytes: bytes,
    internalReviewedObservations: result.observations,
    normalizedObservationCount: result.observations.length,
    reviewRequired: true,
    rightsVerifiedForReuse: false,
    livePricesAvailable: false,
    publishable: false,
    productionEnabled: false,
    externalRequests: 0,
  }
}
