import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { types as nodeTypes } from 'node:util'

// Offline-first DOM selector proposal. NEVER downloads a page, executes scripts,
// exports product/price text, or labels proposed selectors as confirmed.
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_TAGS = 25000
const MAX_SELECTORS = 24
const HTML_TAG = /<([a-z][a-z0-9-]{0,32})\b([^<>]{0,1500})>/gi
const CLASS_ATTR = /\bclass\s*=\s*(?:"([^"]{0,1000})"|'([^']{0,1000})')/i
const STATIC_NAME = /^[a-z][a-z0-9_-]{1,59}$/i
const FIELD_RULES = Object.freeze({
  product: /(?:^|[-_])(product|item|card|tile|sku|article)(?:$|[-_])/i,
  name: /(?:^|[-_])(name|title|label|heading)(?:$|[-_])/i,
  price: /(?:^|[-_])(price|cost|amount|euro|cent)(?:$|[-_])/i,
  pack: /(?:^|[-_])(pack|size|volume|weight|quantity|unit|content)(?:$|[-_])/i,
  offer: /(?:^|[-_])(offer|deal|sale|discount|promo)(?:$|[-_])/i,
  availability: /(?:^|[-_])(stock|available|availability|inventory)(?:$|[-_])/i,
})

// Known merchant attribution must match the genuine public hostname.
// Unknown research retailers remain usable, always in offline review mode.
const KNOWN_RETAILER_HOSTS = Object.freeze({
  plus: 'www.plus.nl',
  dekamarkt: 'www.dekamarkt.nl',
})

// A selector proposal can be called directly from JS, not only from decoded
// JSON. Before reading any field, reject Proxy/getter/inherited identities.
// Snapshot just the required own primitive data; never reuse caller records.
function ownInertFields(input, names) {
  if (input === null || typeof input !== 'object' ||
      Array.isArray(input) || nodeTypes.isProxy(input)) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.length !== names.length ||
      keys.some(key => typeof key !== 'string' || !names.includes(key)) ||
      names.some(key => !Object.hasOwn(descriptors, key) ||
        !Object.hasOwn(descriptors[key], 'value'))) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }
  return Object.freeze(Object.fromEntries(names.map(name =>
    [name, descriptors[name].value])))
}

function validPhysicalUtcTimestamp(value) {
  // Date.parse can normalize impossible days (Feb 30) and 24:00 into the
  // following day; demand a byte-equivalent UTC civil instant on roundtrip.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
  if (!match) return false
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp > Date.now()) return false
  return new Date(timestamp).toISOString() ===
    match[1] + '.' + (match[2] ?? '').padEnd(3, '0') + 'Z'
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
    const expectedHost = Object.hasOwn(KNOWN_RETAILER_HOSTS, origin.retailerId)
      ? KNOWN_RETAILER_HOSTS[origin.retailerId] : null
    return exact && url.protocol === 'https:' &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) &&
      isIP(url.hostname) === 0 &&
      url.port === '' && !url.username && !url.password &&
      !url.search && !url.hash && url.hostname !== 'localhost' &&
      (expectedHost === null || url.hostname === expectedHost) &&
      validPhysicalUtcTimestamp(origin.capturedAt)
  } catch {
    return false
  }
}

export function assertValidOfflineSelectorOrigin(origin) {
  const pinned = ownInertFields(origin, ['retailerId', 'url', 'capturedAt'])
  if (!validSnapshotOrigin(pinned)) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }
  return pinned
}

function removeInertMarkup(html) {
  // Conservative best-effort static analysis, NOT a browser-equivalent parser.
  // Never inspect nested scripts, comments, inputs, head/style or inert markup.
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|noscript|textarea|head|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
}

function recordSelector(counters, field, selector, tag) {
  const key = field + '\u0000' + selector
  const prior = counters.get(key)
  if (prior) prior.instances += 1
  else counters.set(key, { field, selector, tag, instances: 1 })
}

function attribute(attrs, name) {
  const pattern = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]{0,140})"|\\x27([^\\x27]{0,140})\\x27)', 'i')
  const match = pattern.exec(attrs)
  return match ? (match[1] ?? match[2]) : null
}

export function proposeOfflineRetailerSelectors(request = {}) {
  const { html, origin } = ownInertFields(request, ['html', 'origin'])
  const pinnedOrigin = assertValidOfflineSelectorOrigin(origin)
  if (typeof html !== 'string' ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES ||
      Buffer.from(html, 'utf8').toString('utf8') !== html) {
    throw new Error('Invalid or oversized offline retailer snapshot')
  }

  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex')
  const signalMarkup = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(template|noscript|textarea|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const structuredSignals = {
    schemaOrgProduct: /"@type"\s*:\s*"Product"/i.test(signalMarkup),
    nextData: /<script\b[^>]*\bid=["']__NEXT_DATA__["']/i.test(signalMarkup),
    nuxtData: /<script\b[^>]*\bid=["']__NUXT_DATA__["']/i.test(signalMarkup),
    jsonLd: /<script\b[^>]*\btype=["']application\/ld\+json["']/i.test(signalMarkup),
  }

  // Ambiguous unterminated inert markup is rejected; do not accidentally
  // attribute text or selectors from a comment/template to live product DOM.
  if (html.includes('<!--') &&
      (html.match(/<!--/g) || []).length !== (html.match(/-->/g) || []).length) {
    throw new Error('Unterminated HTML comment')
  }
  for (const tag of ['script', 'style', 'template', 'noscript', 'textarea']) {
    const opens = [...html.matchAll(new RegExp('<' + tag + '\\b', 'gi'))].length
    const closes = [...html.matchAll(new RegExp('<\\/' + tag + '\\s*>', 'gi'))].length
    if (opens !== closes) throw new Error('Unbalanced inert HTML element')
  }

  const candidates = new Map()
  const visible = removeInertMarkup(html)
  let inspectedTags = 0
  for (const match of visible.matchAll(HTML_TAG)) {
    if (++inspectedTags > MAX_TAGS) {
      throw new Error('Offline selector scan exceeded bounded tag budget')
    }
    const tag = match[1].toLowerCase()
    if (!['article', 'a', 'div', 'li', 'section', 'span', 'h2', 'h3', 'p', 'strong', 'meta'].includes(tag)) continue
    const attrs = match[2]
    const rawClass = CLASS_ATTR.exec(attrs)
    const classes = rawClass ? (rawClass[1] ?? rawClass[2]).split(/\s+/) : []
    const values = classes.filter(x => STATIC_NAME.test(x)).slice(0, 20)
    for (const name of values) {
      for (const [field, rule] of Object.entries(FIELD_RULES)) {
        if (rule.test(name)) recordSelector(candidates, field, tag + '.' + name, tag)
      }
    }
    for (const name of ['data-testid', 'itemprop']) {
      const token = attribute(attrs, name)
      if (!token || !STATIC_NAME.test(token)) continue
      for (const [field, rule] of Object.entries(FIELD_RULES)) {
        if (rule.test(token)) {
          recordSelector(candidates, field, tag + '[' + name + '="' + token + '"]', tag)
        }
      }
    }
    if (tag === 'a') {
      const href = attribute(attrs, 'href')
      if (href?.startsWith('/product/')) {
        recordSelector(candidates, 'product', 'a[href^="/product/"]', tag)
      } else if (href?.startsWith('/producten/')) {
        recordSelector(candidates, 'product', 'a[href^="/producten/"]', tag)
      }
    }
  }

  // These are candidate CSS selectors for reviewed snapshots; counts are raw
  // tag occurrences, NOT a verified DOM selection and NEVER validated prices.
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
      retailerId: pinnedOrigin.retailerId,
      sha256,
      capturedAt: pinnedOrigin.capturedAt,
    },
    bytes: Buffer.byteLength(html, 'utf8'),
    scannedTags: inspectedTags,
    structuredSignals,
    selectors,
    humanReviewRequired: true,
    readyForIngestion: false,
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
  }
}
