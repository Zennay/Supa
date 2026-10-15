import { createHash } from 'node:crypto'

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

function validSnapshotOrigin(origin) {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) return false
  if (typeof origin.retailerId !== 'string' ||
      !/^[a-z][a-z0-9-]{1,39}$/.test(origin.retailerId) ||
      typeof origin.url !== 'string' ||
      typeof origin.capturedAt !== 'string') return false
  try {
    const url = new URL(origin.url)
    const exact = url.href === origin.url
    const timestamp = Date.parse(origin.capturedAt)
    return exact && url.protocol === 'https:' &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) &&
      url.port === '' && !url.username && !url.password &&
      !url.search && !url.hash && url.hostname !== 'localhost' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(origin.capturedAt) &&
      Number.isFinite(timestamp) && timestamp <= Date.now()
  } catch {
    return false
  }
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

export function proposeOfflineRetailerSelectors({ html, origin } = {}) {
  if (!validSnapshotOrigin(origin) ||
      typeof html !== 'string' ||
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
      retailerId: origin.retailerId,
      sha256,
      capturedAt: origin.capturedAt,
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
