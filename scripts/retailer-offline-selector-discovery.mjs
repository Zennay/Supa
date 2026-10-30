import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { types as nodeTypes } from 'node:util'
import { scanOfflineRetailerMarkup } from './retailer-offline-structural-scan.mjs'
import { isPublicMerchantProductHrefSelector } from './retailer-public-product-href-selectors.mjs'
import { ambiguousRetailerRoute } from './retailer-source-route-safety.mjs'

// Offline-first DOM selector proposal. NEVER downloads a page, executes scripts,
// exports product/price text, or labels proposed selectors as confirmed.
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_TAGS = 25000
const MAX_SELECTORS = 24
const STATIC_NAME = /^[a-z][a-z0-9_-]{1,59}$/i
const MICRODATA_PRODUCT = /^(?:article|section|div|li|a)\[itemtype="https?:\/\/schema\.org\/Product"\]$/
// Exact public Schema.org Microdata attribute names: an observed name alone
// is a *review hint*, never verified price, stock, permission or product data.
// Canonical camelCase fields are common in actual nested Product/Offer markup
// and must not be discarded by heuristics written for CSS class tokens.
const SCHEMA_ITEMPROP_FIELDS = Object.freeze({
  name:'name', price:'price', lowPrice:'price', highPrice:'price',
  priceCurrency:'price', priceSpecification:'price',
  priceValidUntil:'offer', offers:'offer',
  weight:'pack', size:'pack', unitCode:'pack', unitText:'pack',
  availability:'availability', inventoryLevel:'availability',
})


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
    // Existing private archives can be imported without traversing the live
    // one-URL capture gate. Reject on-store checkout/admin routes and ambiguous
    // encoded path separators rather than proposing false merchant products.
    if (requiredHost) {
      const path = url.pathname
      const knownRoute = origin.retailerId === 'plus'
        ? /^\/(?:product\/[^/]+|producten(?:\/.*)?|aanbiedingen(?:\/.*)?)$/.test(path)
        : /^\/(?:producten(?:\/.*)?|aanbiedingen(?:\/.*)?)$/.test(path)
      if (!knownRoute || ambiguousRetailerRoute(path))
        return false
    }
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
  // Common exact-case HTML named character references are also decoded by
  // DOM attribute access. An invented or wrong-case entity stays untouched.
  const named = Object.freeze({ sol: '/', colon: ':', amp: '&' })
  const decoded = value.replace(/&(sol|colon|amp);/g, (_, name) => named[name])
  return decoded.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, (raw, hex, decimal) => {
    const point = Number.parseInt(hex ?? decimal, hex === undefined ? 10 : 16)
    return point > 0 && point <= 0x10ffff &&
      !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : raw
  })
}

// A catalog navigation link to the catalog root is not evidence for a
// product-card href selector. Restrict observed paths to the actual store:
// PLUS uses /product/, whereas /producten/ is Deka's product item route.
function observedProductHrefPrefix(origin, href, documentBaseUrl) {
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
    // Exact relative forms in real DOM href attributes are valid evidence
    // only if resolution against the document's effective base stays within
    // this merchant's product route. Do not fabricate root-relative hrefs.
    const formats = [prefix]
    if (host) formats.push('https://' + host + prefix, '//' + host + prefix,
      prefix.slice(1), '.' + prefix, '..' + prefix)
    for (const observed of formats) {
      if (!href.startsWith(observed)) continue
      try {
        const target = new URL(href, documentBaseUrl)
        const base = new URL(origin.url)
        const slug = target.pathname.slice(prefix.length)
        if (target.origin !== base.origin || target.username || target.password ||
            !target.pathname.startsWith(prefix) ||
            !slug || slug.startsWith('/') ||
            ambiguousRetailerRoute(slug)) return null
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
      typeof html !== 'string' || html.startsWith('\uFEFF') ||
      html.includes('\u0000') ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES ||
      Buffer.from(html, 'utf8').toString('utf8') !== html) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }

  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex')
  // Inspect real HTML element boundaries; never infer signal tags from
  // comments, attributes, script strings or inert DOM containers.
  const { visible, structuredSignals, baseHrefs, canonicalHrefs, hasMetaRefresh, hasMetaNoStore, hasConflictingCharset } = scanOfflineRetailerMarkup(html)
  if (hasMetaRefresh) throw new Error('Untrusted HTML redirect evidence')
  if (hasMetaNoStore) throw new Error('Untrusted HTML no-store archival directive')
  if (hasConflictingCharset) throw new Error('Untrusted HTML charset declaration')
  // Live HTML base href changes the browser resolution of relative product
  // links. Foreign or malformed bases cannot become store product evidence.
  let documentBaseUrl = origin.url
  if (baseHrefs.length) {
    // Offline archives must validate browser-facing href provenance too.
    const href = baseHrefs[0]
    if (typeof href !== 'string' || !href || href.length > 2048 ||
        href.includes('&')) throw new Error('Untrusted HTML base URL')
    let base
    try { base = new URL(href, origin.url) }
    catch { throw new Error('Untrusted HTML base URL') }
    const expected = new URL(origin.url)
    if (base.origin !== expected.origin || base.username || base.password ||
        base.protocol !== 'https:') throw new Error('Untrusted HTML base URL')
    documentBaseUrl = base.href
  }

  // An explicit canonical page identity belonging to another domain makes
  // even otherwise plausible CSS product hints unsafe to attribute to this
  // retailer. No canonical URL is emitted from the private review.
  if (canonicalHrefs.length) {
    const href = canonicalHrefs[0]
    if (typeof href !== 'string' || !href || href.length > 2048 ||
        href.includes('&')) throw new Error('Untrusted HTML canonical source URL')
    let canonical
    try { canonical = new URL(href, origin.url) }
    catch { throw new Error('Untrusted HTML canonical source URL') }
    const expected = new URL(origin.url)
    const normalizedPath = path => path.replace(/\/$/, '') || '/'
    // An older offline archive may claim another SKU on the same store.
    if (canonical.origin !== expected.origin || canonical.username ||
        canonical.password || canonical.protocol !== 'https:' ||
        canonical.search || canonical.hash ||
        normalizedPath(canonical.pathname) !== normalizedPath(expected.pathname))
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
      'h2', 'h3', 'p', 'strong', 'meta', 'link', 'data', 'time'].includes(tag)
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
      if (name === 'itemprop' && Object.hasOwn(SCHEMA_ITEMPROP_FIELDS,token)) {
        recordSelector(candidates,SCHEMA_ITEMPROP_FIELDS[token],
          tag + '[itemprop="' + token + '"]',tag)
      } else {
        for (const [field, rule] of Object.entries(FIELD_RULES)) {
          if (rule.test(token)) {
            recordSelector(candidates, field, tag + '[' + name + '="' + token + '"]', tag)
          }
        }
      }
    }
    // A source-observed Schema.org itemscope is a useful product-container
    // selector even on catalogs without classes, test IDs or product links.
    // Never synthesize this selector if the original DOM does not contain it.
    if (['article','section','div','li','a'].includes(tag) && attrs.has('itemscope')) {
      const itemtype = staticAttributeValue(attrs.get('itemtype'))
      const microdata = tag + '[itemtype="' + itemtype + '"]'
      if (itemtype && MICRODATA_PRODUCT.test(microdata))
        recordSelector(candidates,'product',microdata,tag)
    }
    if (tag === 'a') {
      const href = staticAttributeValue(attrs.get('href'))
      const observed = observedProductHrefPrefix(origin, href, documentBaseUrl)
      if (observed) {
        recordSelector(candidates, 'product', 'a[href^="' + observed + '"]', tag)
        productHrefInstances++
        const product = new URL(href, documentBaseUrl)
        distinctProductPaths.add(product.pathname.replace(/\/$/, ''))
      }
    }
  }

  // These are candidate CSS selectors for reviewed snapshots; counts are raw
  // tag occurrences, NOT a verified DOM selection and NEVER validated prices.
  const selectorCandidatesOmitted = Math.max(0, candidates.size - MAX_SELECTORS)
  // Genuine observed Product roots and Schema.org microdata are the
  // highest-value structural anchors. Keep them inside the 24-candidate
  // review budget even when a large listing emits many noisy price classes.
  // Every proposal must still exist in the original HTML: this ranks, never
  // invents, selectors or enables automatic promotion.
  const observedStructuralConfidence = row => {
    if (row.field === 'product' && (MICRODATA_PRODUCT.test(row.selector) ||
        isPublicMerchantProductHrefSelector(origin.retailerId,row.selector))) return 2
    // Known public Schema.org property names are more stable than ephemeral
    // CSS classes on a large listing. This is only a selector review order;
    // values, price trust and permission gates remain untouched.
    if (Object.entries(SCHEMA_ITEMPROP_FIELDS).some(([prop,field]) =>
      row.field === field && row.selector.endsWith('[itemprop="'+prop+'"]')))
      return 1
    return 0
  }
  const selectors = [...candidates.values()]
    .sort((a, b) => observedStructuralConfidence(b)-observedStructuralConfidence(a) ||
      b.instances - a.instances || a.field.localeCompare(b.field) ||
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
// Offline CLI reports may reveal only the known exact merchant product roots,
// not private per-product hrefs or arbitrary host/source metadata. Preserve
// usable observed absolute selectors for the operator's human drift review.
export function summarizeOfflineSelectorProposals(report) {
  const safe = report.selectors.filter(row => {
    if (row.field === 'product' && MICRODATA_PRODUCT.test(row.selector)) return true
    if (Object.entries(SCHEMA_ITEMPROP_FIELDS).some(([prop,field]) =>
      row.field === field && row.selector.endsWith('[itemprop="'+prop+'"]') &&
      /^(?:article|a|div|li|section|span|h[23]|p|strong|meta|link|data|time)\[itemprop="/.test(row.selector)))
      return true
    if (row.field === 'product' &&
        (isPublicMerchantProductHrefSelector(report.source.retailerId, row.selector) ||
         (!Object.hasOwn(KNOWN_MERCHANT_HOSTS, report.source.retailerId) &&
          ['a[href^="/product/"]','a[href^="/producten/"]'].includes(row.selector)))) return true
    const match = /^[a-z][a-z0-9-]{0,30}(?:\.([a-z][a-z0-9_-]{1,59})|\[(?:data-testid|itemprop)="([a-z][a-z0-9_-]{1,59})"\])$/.exec(row.selector)
    return match && PUBLIC_GENERIC_TOKENS.has(match[1] ?? match[2])
  })
  return {
    ...report,
    selectors: safe,
    privateSelectorCount: report.selectors.length - safe.length,
  }
}
