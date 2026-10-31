import { decodeObservedHtmlAttribute } from './retailer-html-attribute-references.mjs'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { types as nodeTypes } from 'node:util'
import { scanOfflineRetailerMarkup } from './retailer-offline-structural-scan.mjs'
import { isPublicMerchantProductHrefSelector } from './retailer-public-product-href-selectors.mjs'
import { matchObservedSchemaProductSelector } from './retailer-observed-schema-product-selector.mjs'
import { isSafeStructuralReviewTag } from './retailer-public-structural-tag.mjs'
import { isFormerPriceTag, isFormerPriceToken, PUBLIC_OBSERVED_TOKEN_FIELDS } from './retailer-public-observed-token-fields.mjs'
import { ambiguousRetailerRoute, isAllowedM1RetailerSourcePath, validateObservedRetailerDocumentIdentity } from './retailer-source-route-safety.mjs'

// Offline-first DOM selector proposal. NEVER downloads a page, executes scripts,
// exports product/price text, or labels proposed selectors as confirmed.
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_TAGS = 25000
const MAX_SELECTORS = 24
const STATIC_NAME = /^[a-z][a-z0-9_-]{1,59}$/i
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
    const syntax = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(origin.capturedAt)
    if (!syntax) return false
    const timestamp = Date.parse(origin.capturedAt)
    if (!Number.isFinite(timestamp) || timestamp > Date.now()) return false
    // Preserve up to nine explicit UTC fractional digits, as historical M1
    // capture manifests do; Date.parse truncates to milliseconds only for
    // the civil-date validation, never rewrites original source provenance.
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
      // Historical direct selector replay and first-party captures must
      // share exactly one approved merchant route interpretation. A regex
      // accepting '/producten//checkout' cannot bypass the capture contract.
      const knownRoute = ['product','catalog','offers'].some(kind =>
        isAllowedM1RetailerSourcePath(origin.retailerId,kind,path))
      if (!knownRoute) return false
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
export function* openingTags(markup, includeEndTags = false) {
  let cursor = 0
  while (cursor < markup.length) {
    const start = markup.indexOf('<', cursor)
    if (start < 0) return
    if (includeEndTags && markup[start + 1] === '/') {
      const end = /^<\/([a-z][a-z0-9-]{0,32})\s*>/i.exec(markup.slice(start))
      if (end) {
        yield { tag: end[1].toLowerCase(), closing: true }
        cursor = start + end[0].length
        continue
      }
    }
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
export const staticAttributeValue = decodeObservedHtmlAttribute

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
  // HTML <del> is a struck-through *previous* price. Even when the captured
  // retailer uses price-value / itemprop=price, it must not produce a current
  // price candidate. Keep the observed structure as an unapproved offer hint.
  if (isFormerPriceTag(tag) && field === 'price') field = 'offer'
  const key = field + '\u0000' + selector
  const prior = counters.get(key)
  if (prior) prior.instances += 1
  else counters.set(key, { field, selector, tag, instances: 1 })
}

export function assertObservedRetailerHtmlIdentity(originUrl, baseHrefs, canonicalHrefs) {
  return validateObservedRetailerDocumentIdentity(originUrl, baseHrefs, canonicalHrefs)
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
  const { visible, structuredSignals, baseHrefs, canonicalHrefs, hasMetaRefresh, hasMetaNoStore, hasMetaNoArchive, hasConflictingCharset } = scanOfflineRetailerMarkup(html)
  if (hasMetaRefresh) throw new Error('Untrusted HTML redirect evidence')
  if (hasMetaNoStore) throw new Error('Untrusted HTML no-store archival directive')
  if (hasMetaNoArchive) throw new Error('Untrusted HTML robots noarchive directive')
  if (hasConflictingCharset) throw new Error('Untrusted HTML charset declaration')
  const documentBaseUrl=assertObservedRetailerHtmlIdentity(
    origin.url,baseHrefs,canonicalHrefs)

  const candidates = new Map()
  // Any generic selector matching an old-price-labelled element cannot be
  // trusted as a current-price hint, even when it also matches new prices.
  const ambiguousCurrentPriceSelectors = new Set()
  // Duplicate links to one SKU on a listing are not independent products.
  // Keep URL identities only in this short-lived private scan; expose count
  // aggregates, never product paths, search params or identifiers.
  let productHrefInstances = 0
  const distinctProductPaths = new Set()
  let inspectedTags = 0
  const ancestorStack = []
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])
  // The HTML parser automatically ends an open <p> when a block element
  // starts. Without this, a stale-price paragraph can incorrectly suppress
  // a genuinely separate current-price sibling on retailer listing pages.
  const closesParagraph = new Set(['address','article','aside','blockquote','div','dl',
    'fieldset','footer','form','h1','h2','h3','h4','h5','h6','header','hgroup',
    'hr','main','menu','nav','ol','p','pre','search','section','table','ul'])
  for (const match of openingTags(visible, true)) {
    if (match.closing) {
      // Browsers ignore unmatched ordinary closing tags. Do not clear a
      // known old-price ancestor merely because an attacker adds </unknown>.
      const last = ancestorStack.findLastIndex(row => row.tag === match.tag)
      if (last >= 0) ancestorStack.length = last
      continue
    }
    if (++inspectedTags > MAX_TAGS) {
      throw new Error('Offline selector scan exceeded bounded tag budget')
    }
    const tag = match.tag
    if (closesParagraph.has(tag)) {
      const paragraph=ancestorStack.findLastIndex(row=>row.tag==='p')
      if (paragraph>=0) ancestorStack.length=paragraph
    }
    if (tag==='li') {
      const prior=ancestorStack.findLastIndex(row=>row.tag==='li')
      // An inner <ul>/<ol>/<menu> starts a genuinely nested list; its
      // <li> children remain inside the outer item and inherit former-price
      // context. Only siblings under the SAME list implicitly close a <li>.
      if (prior>=0 && !ancestorStack.slice(prior+1)
        .some(row=>row.tag==='ul'||row.tag==='ol'||row.tag==='menu'))
        ancestorStack.length=prior
    }
    // Browsers also imply a </tr> or </td>/<th> at the next peer. Keep
    // a nested <table> barrier so a former-price cell containing its own
    // table never promotes a nested former price as a fresh sibling.
    if (tag==='tr') {
      const prior=ancestorStack.findLastIndex(row=>row.tag==='tr')
      if (prior>=0 && !ancestorStack.slice(prior+1)
        .some(row=>row.tag==='table')) ancestorStack.length=prior
    }
    if (tag==='td'||tag==='th') {
      const prior=ancestorStack.findLastIndex(row=>row.tag==='td'||row.tag==='th')
      if (prior>=0 && !ancestorStack.slice(prior+1)
        .some(row=>row.tag==='tr'||row.tag==='table')) ancestorStack.length=prior
    }
    const standardCandidate = ['article', 'a', 'div', 'li', 'section', 'span',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'ins', 'del', 's', 'strike', 'small', 'meta', 'link', 'data', 'time'].includes(tag)
    // Real SPA/retailer custom elements are valid HTML with a hyphenated
    // tag name. Only offer selectors whose exact tags/classes exist in the
    // approved local source; no made-up shadow DOM or descendant paths.
    const actualCustomElement = /^[a-z][a-z0-9]*-[a-z0-9-]{1,31}$/.test(tag)
    const attrs = match.attrs
    // HTML class tokens split on ASCII whitespace, not JavaScript's wider \s
    // (NBSP is a class-name character). Repeated tokens match one element,
    // not multiple CSS elements; counting duplicates creates false drift.
    const classes = (staticAttributeValue(attrs.get('class')) ?? '').split(/[ \t\n\f\r]+/)
    const values = [...new Set(classes.filter(x => STATIC_NAME.test(x)))].slice(0, 20)
    // A nested price-looking element within a former-price wrapper is NOT
    // evidence of a current price, even when its own class is generic.
    const localFormer = isFormerPriceTag(tag) || values.some(isFormerPriceToken) ||
      ['data-testid','data-test','data-qa'].some(name =>
        isFormerPriceToken(staticAttributeValue(attrs.get(name))))
    const inheritedFormer = ancestorStack.some(row => row.former)
    const formerPriceContext = inheritedFormer || (localFormer && !isFormerPriceTag(tag))
    if (!voidTags.has(tag)) ancestorStack.push({ tag, former: inheritedFormer || localFormer })
    if (!standardCandidate && !actualCustomElement) continue
    const addObserved = (field, selector) => {
      if (formerPriceContext && field === 'price') {
        ambiguousCurrentPriceSelectors.add(selector)
        return
      }
      recordSelector(candidates, field, selector, tag)
    }
    for (const name of values) {
      const exact = Object.hasOwn(PUBLIC_OBSERVED_TOKEN_FIELDS,name)
        ? PUBLIC_OBSERVED_TOKEN_FIELDS[name] : null
      if (exact) addObserved(exact, tag + '.' + name)
      else for (const [field, rule] of Object.entries(FIELD_RULES)) {
        if (rule.test(name)) addObserved(field, tag + '.' + name)
      }
    }
    for (const name of ['data-testid', 'data-test', 'data-qa', 'itemprop']) {
      const token = staticAttributeValue(attrs.get(name))
      if (!token || !STATIC_NAME.test(token)) continue
      if (name === 'itemprop' && Object.hasOwn(SCHEMA_ITEMPROP_FIELDS,token)) {
        addObserved(SCHEMA_ITEMPROP_FIELDS[token],
          tag + '[itemprop="' + token + '"]')
      } else {
        const exact = Object.hasOwn(PUBLIC_OBSERVED_TOKEN_FIELDS,token)
          ? PUBLIC_OBSERVED_TOKEN_FIELDS[token] : null
        if (exact) addObserved(exact, tag + '[' + name + '="' + token + '"]')
        else for (const [field, rule] of Object.entries(FIELD_RULES)) {
          if (rule.test(token)) addObserved(field, tag + '[' + name + '="' + token + '"]')
        }
      }
    }
    // A source-observed Schema.org itemscope is a useful product-container
    // selector even on catalogs without classes, test IDs or product links.
    // Never synthesize this selector if the original DOM does not contain it.
    if (['article','section','div','li','a'].includes(tag) && attrs.has('itemscope')) {
      const itemtype = staticAttributeValue(attrs.get('itemtype'))
      const microdata = tag + '[itemtype="' + itemtype + '"]'
      if (itemtype && matchObservedSchemaProductSelector(microdata))
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
  // Genuine observed Product roots and Schema.org microdata are the
  // highest-value structural anchors. Keep them inside the 24-candidate
  // review budget even when a large listing emits many noisy price classes.
  // Every proposal must still exist in the original HTML: this ranks, never
  // invents, selectors or enables automatic promotion.
  const observedStructuralConfidence = row => {
    if (row.field === 'product' && (matchObservedSchemaProductSelector(row.selector) ||
        isPublicMerchantProductHrefSelector(origin.retailerId,row.selector))) return 2
    // Known public Schema.org property names are more stable than ephemeral
    // CSS classes on a large listing. This is only a selector review order;
    // values, price trust and permission gates remain untouched.
    if (Object.entries(SCHEMA_ITEMPROP_FIELDS).some(([prop,field]) =>
      row.field === field && row.selector.endsWith('[itemprop="'+prop+'"]')))
      return 1
    // Existing, source-observed public class/test-id tokens are more useful
    // to an operator than hundreds of unique hashed/retailer noise tokens.
    // This prioritises review only; it NEVER creates an absent selector.
    const match=/^[a-z][a-z0-9-]{0,32}(?:\.([a-z][a-z0-9_-]{1,59})|\[(?:data-testid|data-test|data-qa)="([a-z][a-z0-9_-]{1,59})"\])$/.exec(row.selector)
    const token=match?.[1] ?? match?.[2]
    const known=token && Object.hasOwn(PUBLIC_OBSERVED_TOKEN_FIELDS,token)
      ? PUBLIC_OBSERVED_TOKEN_FIELDS[token] : null
    if (known && (known===row.field ||
        (known==='price' && row.field==='offer' &&
         isFormerPriceTag(row.tag)))) return 1
    return 0
  }
  for (const selector of ambiguousCurrentPriceSelectors)
    candidates.delete('price\u0000' + selector)
  // A noisy listing should never spend all 24 review slots on one category.
  // Reserve one real observed candidate per available semantic field first.
  const compare=(a,b)=>observedStructuralConfidence(b)-observedStructuralConfidence(a) ||
    b.instances-a.instances || a.field.localeCompare(b.field) ||
    a.selector.localeCompare(b.selector)
  const ranked=[...candidates.values()].sort(compare)
  const reserved=new Set()
  for (const field of ['product','name','price','pack','offer','availability']) {
    const best=ranked.find(row=>row.field===field)
    if (best) reserved.add(best)
  }
  const selected=[...reserved]
  for (const row of ranked) {
    if (selected.length>=MAX_SELECTORS) break
    if (!reserved.has(row)) selected.push(row)
  }
  const selectorCandidatesOmitted=Math.max(0,candidates.size-MAX_SELECTORS)
  const selectors=selected.sort(compare).map(({field,selector,instances})=>({
    field,selector,instances,status:'needs-human-review',
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
  'pack','pack-size','size','unit','old-price','price-old','price-before',
  'previous-price','was-price','original-price','offer','offer-card','offer-label',
  'deal','sale','discount','stock','stock-label','availability',
])
// Offline CLI reports may reveal only the known exact merchant product roots,
// not private per-product hrefs or arbitrary host/source metadata. Preserve
// usable observed absolute selectors for the operator's human drift review.
export function summarizeOfflineSelectorProposals(report) {
  const safe = report.selectors.filter(row => {
    if (!row || typeof row.selector !== 'string') return false
    // CSS selectors contain observed tag names. A custom element may embed
    // a product SKU, customer name or price even if its class is generic.
    // Human-facing CLI output must obey the same vocabulary as private replay.
    const tag = /^[a-z][a-z0-9-]*/.exec(row.selector)?.[0]
    if (!isSafeStructuralReviewTag(tag)) return false
    if (row.field === 'product' && matchObservedSchemaProductSelector(row.selector)) return true
    if (Object.entries(SCHEMA_ITEMPROP_FIELDS).some(([prop,field]) =>
      (row.field === field || row.field === 'offer' && field === 'price' &&
        isFormerPriceTag(row.selector.split('[')[0])) &&
      row.selector.endsWith('[itemprop="'+prop+'"]') &&
      /^(?:article|a|div|li|section|span|h[1-6]|p|strong|ins|del|s|strike|small|meta|link|data|time)\[itemprop="/.test(row.selector)))
      return true
    if (row.field === 'product' &&
        (isPublicMerchantProductHrefSelector(report.source.retailerId, row.selector) ||
         (!Object.hasOwn(KNOWN_MERCHANT_HOSTS, report.source.retailerId) &&
          ['a[href^="/product/"]','a[href^="/producten/"]'].includes(row.selector)))) return true
    const match = /^[a-z][a-z0-9-]{0,30}(?:\.([a-z][a-z0-9_-]{1,59})|\[(?:data-testid|itemprop)="([a-z][a-z0-9_-]{1,59})"\])$/.exec(row.selector)
    if (!match) return false
    const token = match[1] ?? match[2]
    const exact = Object.hasOwn(PUBLIC_OBSERVED_TOKEN_FIELDS,token)
      ? PUBLIC_OBSERVED_TOKEN_FIELDS[token] : null
    if (exact) return row.field === exact ||
      (isFormerPriceTag(tag) && exact === 'price' && row.field === 'offer')
    return PUBLIC_GENERIC_TOKENS.has(token)
  })
  return {
    ...report,
    selectors: safe,
    privateSelectorCount: report.selectors.length - safe.length,
  }
}
