/**
 * M3 offline product-page bridge for a previously authorized HTML capture.
 *
 * It does NOT perform requests or verify capture permissions, checkout prices,
 * availability at purchase, or public savings. All JSON-LD scripts on ONE page
 * form a single source identity. Never count recommended products as a second
 * purchase solely because they appear in another script.
 */
import { createHash } from 'node:crypto'
import { types as nodeTypes } from 'node:util'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'

const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_JSONLD_BYTES = 256 * 1024
const MAX_JSONLD_SCRIPTS = 100
const CAPTURED_AT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|([+-])(\d{2}):(\d{2}))$/

function abstain(reason) {
  return {
    type: 'abstain',
    reason,
    evidenceStatus: 'offline-preview-not-retailer-verification',
    publicSavingsClaimEligible: false,
  }
}

/** Refuse malformed attributes and duplicate type= instead of guessing. */
function isJsonLdScript(attrs) {
  let rest = attrs
  let type = null
  let externalSrc = false
  while (rest.trim()) {
    const match =
      /^\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/.exec(rest)
    if (!match) return false
    const attribute = match[1].toLowerCase()
    if (attribute === 'type') {
      if (type !== null) return false
      type = match[2] ?? match[3] ?? match[4] ?? ''
    } else if (attribute === 'src') {
      // A JSON-LD data block bearing src is NOT authenticated inline HTML.
      // Refuse the whole page rather than silently select a later product.
      externalSrc = true
    }
    rest = rest.slice(match[0].length)
  }
  if (type?.trim().toLowerCase() !== 'application/ld+json') return false
  return externalSrc ? null : true
}


function validCapturedAt(value) {
  if (typeof value !== 'string') return false
  const match = CAPTURED_AT_PATTERN.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second, offHours, offMinutes] =
    [match[1], match[2], match[3], match[4], match[5], match[6] ?? '00',
      match[9] ?? '00', match[10] ?? '00'].map(Number)
  const midnight = new Date(Date.UTC(year, month - 1, day))
  if (midnight.getUTCFullYear() !== year ||
      midnight.getUTCMonth() + 1 !== month ||
      midnight.getUTCDate() !== day ||
      hour > 23 || minute > 59 || second > 59 ||
      offHours > 14 || offMinutes > 59 ||
      (offHours === 14 && offMinutes !== 0)) return false
  return Number.isFinite(Date.parse(value))
}

const SOURCE_FIELDS = Object.freeze(['kind', 'supermarket', 'url'])

// Own-data-only immutable snapshot before any validation or HTML inspection.
// Node's native Proxy test avoids executing caller-supplied reflection traps.
function pinnedSourceIdentity(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      nodeTypes.isProxy(source) || Object.getPrototypeOf(source) !== Object.prototype) {
    return null
  }
  const keys = Reflect.ownKeys(source)
  if (keys.length !== SOURCE_FIELDS.length ||
      !SOURCE_FIELDS.every((key) => keys.includes(key))) return null
  const pinned = {}
  for (const key of SOURCE_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable ||
        typeof descriptor.value !== 'string') return null
    pinned[key] = descriptor.value
  }
  return Object.freeze(pinned)
}

function validSource(source, capturedAt) {
  if (source?.kind !== 'product' || typeof source.url !== 'string' ||
      typeof capturedAt !== 'string' ||
      !CAPTURED_AT_PATTERN.test(capturedAt) ||
      !validCapturedAt(capturedAt)) return false
  const routes = {
    plus: ['www.plus.nl', '/product/'],
    dekamarkt: ['www.dekamarkt.nl', '/producten/'],
  }
  const expected = routes[source.supermarket]
  if (!expected) return false
  try {
    const url = new URL(source.url)
    return url.protocol === 'https:' && url.hostname === expected[0] &&
      url.port === '' && url.username === '' && url.password === '' &&
      url.search === '' && url.hash === '' &&
      url.href === source.url &&
      url.pathname.startsWith(expected[1]) &&
      url.pathname.length > expected[1].length
  } catch {
    return false
  }
}

function extractJsonLdDocuments(html) {
  // Comments and inert DOM fragments are not active product script elements.
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '')
  if (withoutComments.includes('<!--')) return null
  const active = withoutComments.replace(
    /<(template|noscript|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '',
  )
  // Nested or malformed inert containers may leave script-looking fragments
  // behind after conservative removal. A stray opener OR closer must refuse
  // the entire snapshot, never promote an inert recommended price to active.
  if (/<\/?(?:template|noscript|textarea)\b/i.test(active)) return null

  // A malformed script boundary must not enable a fallback to a different
  // (possibly cheaper) script that did happen to parse.
  const opens = [...active.matchAll(/<script\b/gi)].length
  const closes = [...active.matchAll(/<\/script\s*>/gi)].length
  if (opens !== closes || opens > 250) return null

  const documents = []
  let count = 0
  let matched = 0
  for (const script of active.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    matched += 1
    const inline = isJsonLdScript(script[1])
    if (inline === null) return null
    if (!inline) continue
    count += 1
    if (count > MAX_JSONLD_SCRIPTS ||
        Buffer.byteLength(script[2], 'utf8') > MAX_JSONLD_BYTES) {
      return null
    }
    try {
      documents.push(parseUniqueKeyRetailerJson(script[2]))
    } catch {
      // Fail the *whole* page. It is unsafe to use a later, valid looking
      // product price after another declared JSON-LD script was corrupted.
      return null
    }
  }
  if (matched !== opens) return null
  return { count, documents }
}

/**
 * Does not mutate the source or expose private contents on errors. Emits ONE
 * observation maximum (never a recommended-product shopping list).
 *
 * Input source = { supermarket:'plus'|'dekamarkt',kind:'product',url }.
 * Caller is responsible for source rights and for freshness/study comparison.
 */
export function parseM3OfflineProductHtml(input = {}) {
  try {
    if (!input || typeof input !== 'object') {
      return abstain('invalid offline retailer product snapshot')
    }
    const { source, html, capturedAt } = input
    const pinnedSource = pinnedSourceIdentity(source)
    if (!pinnedSource || !validSource(pinnedSource, capturedAt) ||
        typeof html !== 'string' ||
        Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES ||
        Buffer.from(html, 'utf8').toString('utf8') !== html) {
      return abstain('invalid offline retailer product snapshot')
    }
    const extracted = extractJsonLdDocuments(html)
    if (!extracted) return abstain('malformed or unsafe JSON-LD scripts')
    if (extracted.count === 0) return abstain('no active JSON-LD script')

    const provenance = {
      supermarket: pinnedSource.supermarket,
      kind: pinnedSource.kind,
      url: pinnedSource.url,
      capturedAt,
      sha256: createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex'),
    }
    // CRITICAL: select from the aggregate page, not from each individual
    // script. Two scripts representing different products remain one page.
    const result = parseSchemaOrgProductForPage(extracted.documents, provenance)
    if (result.type !== 'observation') {
      return abstain('source-bound Product could not be verified')
    }
    return {
      type: 'observation',
      observation: result.observation,
      provenance,
      jsonLdScriptsInspected: extracted.count,
      evidenceStatus: 'offline-preview-not-retailer-verification',
      publicSavingsClaimEligible: false,
    }
  } catch {
    return abstain('invalid offline retailer product snapshot')
  }
}
