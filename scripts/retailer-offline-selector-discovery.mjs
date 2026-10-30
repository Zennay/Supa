import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { types as nodeTypes } from 'node:util'
import { scanOfflineRetailerMarkup } from './retailer-offline-structural-scan.mjs'

// Offline-first DOM selector proposal. NEVER downloads a page, executes scripts,
// exports product/price text, or labels proposed selectors as confirmed.
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_TAGS = 25000
const MAX_SELECTORS = 24
const STATIC_NAME = /^[a-z][a-z0-9_-]{1,59}$/i
const KNOWN_MERCHANT_HOSTS = Object.freeze({ plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' })
const FIELD_RULES = Object.freeze({
  product: /(?:^|[-_])(product|item|card|tile|sku|article)(?:$|[-_])/i,
  name: /(?:^|[-_])(name|title|label|heading)(?:$|[-_])/i,
  price: /(?:^|[-_])(price|cost|amount|euro|cent)(?:$|[-_])/i,
  pack: /(?:^|[-_])(pack|size|volume|weight|quantity|unit|content)(?:$|[-_])/i,
  offer: /(?:^|[-_])(offer|deal|sale|discount|promo)(?:$|[-_])/i,
  availability: /(?:^|[-_])(stock|available|availability|inventory)(?:$|[-_])/i,
})

function inertRecord(value, keys) {
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value) || Array.isArray(value)) return null
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !keys.includes(k))) return null
  const clean = Object.create(null)
  for (const key of keys) {
    const d = descriptors[key]
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string') return null
    clean[key] = d.value
  }
  return clean
}

function validSnapshotOrigin(origin) {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) return false
  if (typeof origin.retailerId !== 'string' ||
      !/^[a-z][a-z0-9-]{1,39}$/.test(origin.retailerId) ||
      typeof origin.url !== 'string' ||
      typeof origin.capturedAt !== 'string') return false
  try {
    const url = new URL(origin.url)
    const exact = url.href === origin.url
    const syntax = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(origin.capturedAt)
    if (!syntax) return false
    const timestamp = Date.parse(origin.capturedAt)
    if (!Number.isFinite(timestamp) || timestamp > Date.now()) return false
    // Date.parse silently normalizes impossible Gregorian dates (e.g. Feb 30).
    // Preserve the user's ORIGINAL UTC clock in SHA-linked source metadata.
    const civilUtc = new Date(timestamp).toISOString().slice(0, 19)
    if (origin.capturedAt.slice(0, 19) !== civilUtc) return false
    // These two retailer IDs have exact known official hosts; a historical
    // foreign-host page must not be mislabeled as either merchant.
    const requiredHost = Object.hasOwn(KNOWN_MERCHANT_HOSTS, origin.retailerId)
      ? KNOWN_MERCHANT_HOSTS[origin.retailerId] : null
    if (requiredHost && url.hostname !== requiredHost) return false
    return exact && url.protocol === 'https:' &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) &&
      isIP(url.hostname) === 0 &&
      url.port === '' && !url.username && !url.password &&
      !url.search && !url.hash && url.hostname !== 'localhost' &&
      Number.isFinite(timestamp)
  } catch {
    return false
  }
}

// Only actual opening tags count. A quoted attribute may contain '<tag>'
// text; that text must never be interpreted as an independent DOM element.
function* openingTags(markup) {
  let cursor = 0
  while (cursor < markup.length) {
    const start = markup.indexOf('<', cursor)
    if (start < 0) return
    const match = /^<([a-z][a-z0-9-]{0,32})\b/i.exec(markup.slice(start))
    if (!match) { cursor = start + 1; continue }
    const attributeStart = start + match[0].length
    let quote = null
    let end = attributeStart
    for (; end < markup.length; end++) {
      const character = markup[end]
      if (quote) {
        if (character === quote) quote = null
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '<') {
        throw new Error('Untrusted malformed opening tag')
      } else if (character === '>') break
    }
    if (end >= markup.length || quote) throw new Error('Unterminated opening tag')
    const attrs = parseHtmlAttributes(markup.slice(attributeStart, end))
    if (attrs === null) throw new Error('Invalid HTML attributes')
    yield { tag: match[1].toLowerCase(), attrs }
    cursor = end + 1
  }
}

function parseHtmlAttributes(text) {
  const attrs = new Map()
  let pos = 0
  while (pos < text.length) {
    while (/\s/.test(text[pos] ?? '')) pos++
    if (pos === text.length || text.slice(pos).trim() === '/') break
    const name = /^[a-z_:][a-z0-9_.:-]*/i.exec(text.slice(pos))?.[0]
    if (!name || attrs.size >= 64) return null
    pos += name.length
    const key = name.toLowerCase()
    if (attrs.has(key)) return null
    while (/\s/.test(text[pos] ?? '')) pos++
    let value = null
    if (text[pos] === '=') {
      pos++
      while (/\s/.test(text[pos] ?? '')) pos++
      if (text[pos] === '"' || text[pos] === "'") {
        const quote = text[pos++]
        const end = text.indexOf(quote, pos)
        if (end < 0) return null
        value = text.slice(pos, end)
        pos = end + 1
      } else {
        const token = /^[^\s<>=`"']+/.exec(text.slice(pos))?.[0]
        if (!token) return null
        value = token
        pos += token.length
      }
      if (value.length > 1000) return null
    }
    attrs.set(key, value)
  }
  return attrs
}

// Numeric HTML character references in attributes are decoded by the browser
// before classList, dataset, itemprop or href are read. Only known valid
// Unicode scalars with an explicit terminator are decoded; ambiguous input
// remains inert and can never invent a selector. No DOM/scripts/network.
function staticAttributeValue(value) {
  if (typeof value !== 'string') return value
  return value.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, (raw, hex, decimal) => {
    const point = Number.parseInt(hex ?? decimal, hex === undefined ? 10 : 16)
    return point > 0 && point <= 0x10ffff &&
      !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : raw
  })
}

// A catalog navigation link to the catalog root is not evidence for a
// product-card href selector. Restrict observed paths to the actual store:
// PLUS uses /product/, whereas /producten/ is Deka's product item route.
function observedProductHrefPrefix(origin, href) {
  if (typeof href !== 'string') return null
  const paths = origin.retailerId === 'plus' ? ['/product/']
    : origin.retailerId === 'dekamarkt' ? ['/producten/']
    : ['/product/', '/producten/'] // other offline research sources
  const host = Object.hasOwn(KNOWN_MERCHANT_HOSTS, origin.retailerId)
    ? KNOWN_MERCHANT_HOSTS[origin.retailerId] : null
  for (const prefix of paths) {
    // Only propose a CSS href-prefix that actually appeared in the captured
    // DOM. Absolute and protocol-relative same-store links are ordinary HTML;
    // never invent a root-relative selector for them.
    const formats = [prefix]
    if (host) formats.push('https://' + host + prefix, '//' + host + prefix)
    for (const observed of formats) {
      if (!href.startsWith(observed)) continue
      try {
        const target = new URL(href, origin.url)
        const base = new URL(origin.url)
        const slug = target.pathname.slice(prefix.length)
        if (target.origin !== base.origin || target.username || target.password ||
            !target.pathname.startsWith(prefix) ||
            !slug || slug.startsWith('/') ||
            /%(?:2f|5c)/i.test(slug)) return null
        return observed
      } catch { return null }
    }
  }
  return null
}

function recordSelector(counters, field, selector, tag) {
  const key = field + '\u0000' + selector
  const prior = counters.get(key)
  if (prior) prior.instances += 1
  else counters.set(key, { field, selector, tag, instances: 1 })
}

export function proposeOfflineRetailerSelectors(options = {}, includePrivateCoverage = false) {
  // Inspect own DATA descriptors before reading untrusted provenance/HTML.
  // Never run a caller getter, inherited identity or Proxy trap.
  if (!options || typeof options !== 'object' || nodeTypes.isProxy(options) ||
      Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }
  const descriptors = Object.getOwnPropertyDescriptors(options)
  if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !['html','origin'].includes(k)) ||
      !Object.hasOwn(descriptors.html ?? {}, 'value') ||
      !Object.hasOwn(descriptors.origin ?? {}, 'value') ||
      typeof descriptors.html.value !== 'string') {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }
  const html = descriptors.html.value
  const origin = inertRecord(descriptors.origin.value, ['retailerId','url','capturedAt'])
  if (!validSnapshotOrigin(origin) ||
      typeof html !== 'string' ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES ||
      Buffer.from(html, 'utf8').toString('utf8') !== html) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }

  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex')
  // Inspect real HTML element boundaries; never infer signal tags from
  // comments, attributes, script strings or inert DOM containers.
  const { visible, structuredSignals, baseHrefs, canonicalHrefs, hasMetaRefresh } = scanOfflineRetailerMarkup(html)
  if (hasMetaRefresh) throw new Error('Untrusted HTML redirect evidence')
  // Live HTML base href changes the browser resolution of relative product
  // links. Foreign or malformed bases cannot become store product evidence.
  if (baseHrefs.length) {
    let base
    try { base = new URL(staticAttributeValue(baseHrefs[0]), origin.url) }
    catch { throw new Error('Untrusted HTML base URL') }
    const expected = new URL(origin.url)
    if (base.origin !== expected.origin || base.username || base.password ||
        base.protocol !== 'https:') throw new Error('Untrusted HTML base URL')
  }

  // An explicit canonical page identity belonging to another domain makes
  // even otherwise plausible CSS product hints unsafe to attribute to this
  // retailer. No canonical URL is emitted from the private review.
  if (canonicalHrefs.length) {
    let canonical
    try { canonical = new URL(staticAttributeValue(canonicalHrefs[0]), origin.url) }
    catch { throw new Error('Untrusted HTML canonical source URL') }
    const expected = new URL(origin.url)
    if (canonical.origin !== expected.origin || canonical.username ||
        canonical.password || canonical.protocol !== 'https:')
      throw new Error('Untrusted HTML canonical source URL')
  }

  const candidates = new Map()
  // Duplicate links to one SKU on a listing are not independent products.
  // Keep URL identities only in this short-lived private scan; expose count
  // aggregates, never product paths, search params or identifiers.
  let productHrefInstances = 0
  const distinctProductPaths = new Set()
  let inspectedTags = 0
  for (const match of openingTags(visible)) {
    if (++inspectedTags > MAX_TAGS) {
      throw new Error('Offline selector scan exceeded bounded tag budget')
    }
    const tag = match.tag
    const standardCandidate = ['article', 'a', 'div', 'li', 'section', 'span',
      'h2', 'h3', 'p', 'strong', 'meta'].includes(tag)
    // Real SPA/retailer custom elements are valid HTML with a hyphenated
    // tag name. Only offer selectors whose exact tags/classes exist in the
    // approved local source; no made-up shadow DOM or descendant paths.
    const actualCustomElement = /^[a-z][a-z0-9]*-[a-z0-9-]{1,31}$/.test(tag)
    if (!standardCandidate && !actualCustomElement) continue
    const attrs = match.attrs
    // HTML class tokens split on ASCII whitespace, not JavaScript's wider \s
    // (NBSP is a class-name character). Repeated tokens match one element,
    // not multiple CSS elements; counting duplicates creates false drift.
    const classes = (staticAttributeValue(attrs.get('class')) ?? '').split(/[ \t\n\f\r]+/)
    const values = [...new Set(classes.filter(x => STATIC_NAME.test(x)))].slice(0, 20)
    for (const name of values) {
      for (const [field, rule] of Object.entries(FIELD_RULES)) {
        if (rule.test(name)) recordSelector(candidates, field, tag + '.' + name, tag)
      }
    }
    for (const name of ['data-testid', 'itemprop']) {
      const token = staticAttributeValue(attrs.get(name))
      if (!token || !STATIC_NAME.test(token)) continue
      for (const [field, rule] of Object.entries(FIELD_RULES)) {
        if (rule.test(token)) {
          recordSelector(candidates, field, tag + '[' + name + '="' + token + '"]', tag)
        }
      }
    }
    if (tag === 'a') {
      const href = staticAttributeValue(attrs.get('href'))
      const observed = observedProductHrefPrefix(origin, href)
      if (observed) {
        recordSelector(candidates, 'product', 'a[href^="' + observed + '"]', tag)
        productHrefInstances++
        const product = new URL(href, origin.url)
        distinctProductPaths.add(product.pathname.replace(/\/$/, ''))
      }
    }
  }

  // These are candidate CSS selectors for reviewed snapshots; counts are raw
  // tag occurrences, NOT a verified DOM selection and NEVER validated prices.
  const selectorCandidatesOmitted = Math.max(0, candidates.size - MAX_SELECTORS)
  const selectors = [...candidates.values()]
    .sort((a, b) => b.instances - a.instances || a.field.localeCompare(b.field) ||
      a.selector.localeCompare(b.selector))
    .slice(0, MAX_SELECTORS)
    .map(({ field, selector, instances }) => ({
      field, selector, instances, status: 'needs-human-review',
    }))
  return {
    schemaVersion: 1,
    mode: 'offline-selector-proposals-only',
    source: {
      retailerId: origin.retailerId,
      sha256,
      capturedAt: origin.capturedAt,
    },
    bytes: Buffer.byteLength(html, 'utf8'),
    scannedTags: inspectedTags,
    // Existing immutable drift schema has exact owned keys. Include this
    // private-only diagnostic in the explicit stability inspection route;
    // normal selector reports retain their existing v1 serialized contract.
    ...(includePrivateCoverage === true ? {
      selectorCandidatesOmitted,
      candidateLimitReached: selectorCandidatesOmitted > 0,
      observedProductLinkOccurrences: productHrefInstances,
      distinctObservedProductPaths: distinctProductPaths.size,
    } : {}),
    structuredSignals,
    selectors,
    humanReviewRequired: true,
    readyForIngestion: false,
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
  }
}

// Console output is not an authorized private HTML artifact. CSS classes and
// testids can embed SKU, supplier or price data even when text values are
// omitted. Preserve full proposals only in the caller's in-memory/private
// review, and show the CLI only known generic selectors + an aggregate count.
const PUBLIC_GENERIC_TOKENS = new Set([
  'product','product-card','product-name','item','item-card','item-name',
  'name','title','label','price','price-value','price-label','price-tag',
  'pack','pack-size','size','unit','offer','offer-card','offer-label',
  'deal','sale','discount','stock','stock-label','availability',
])
export function summarizeOfflineSelectorProposals(report) {
  const safe = report.selectors.filter(row => {
    if (row.selector === 'a[href^="/product/"]' ||
        row.selector === 'a[href^="/producten/"]') return true
    const match = /^[a-z][a-z0-9-]{0,30}(?:\.([a-z][a-z0-9_-]{1,59})|\[(?:data-testid|itemprop)="([a-z][a-z0-9_-]{1,59})"\])$/.exec(row.selector)
    return match && PUBLIC_GENERIC_TOKENS.has(match[1] ?? match[2])
  })
  return {
    ...report,
    selectors: safe,
    privateSelectorCount: report.selectors.length - safe.length,
  }
}
