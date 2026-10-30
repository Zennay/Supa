import { scanOfflineRetailerMarkup } from './retailer-offline-structural-scan.mjs'
import { assertObservedRetailerHtmlIdentity } from './retailer-offline-selector-discovery.mjs'
import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'

/**
 * Strict, bounded script-tag evidence reader for permission-gated HTML.
 *
 * HTML data-id/data-type and quoted attribute contents are NOT authoritative
 * id/type attributes. Fail closed on duplicate or malformed script metadata.
 * No execution, browser, network, filesystem access or public price claims.
 */
const MAX_SCRIPT_TAGS = 96
const MAX_SCRIPT_BYTES = 1024 * 1024
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_JSONLD = 16

// JSON-LD permits absolute Schema.org type IRIs as well as short terms.
// Normalize only exact known Schema.org class IRIs for the legacy private
// parsers, without changing the SHA-bound original HTML/capture bytes.
// Arbitrary hosts or lookalike /Product URLs remain untrusted.
function normalizeKnownSchemaType(value) {
  const canonical = item => {
    if (typeof item !== 'string') return item
    const match = /^https?:\/\/schema\.org\/(Product|Offer|AggregateOffer)$/.exec(item)
    return match ? match[1] : item
  }
  return Array.isArray(value) ? value.map(canonical) : canonical(value)
}

// Read the exact same quote-aware DOM-script boundaries as the offline
// selector review, not a separate regex that could treat inert HTML as prices.
// No raw HTML or private product values are returned to public callers.

export function readAuthorizedHtmlScriptEvidence(html, sourceUrl = undefined) {
  // The direct price-evidence path must preserve the same exact UTF-8
  // source bytes as the capture and offline selector entrypoints.
  if (typeof html !== 'string' || !html || html.startsWith('\uFEFF') ||
      html.includes('\u0000') ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES ||
      Buffer.from(html, 'utf8').toString('utf8') !== html) {
    return { invalid: true, jsonLdBlocks: [], nuxtPayload: null }
  }
  const invalid = () => ({ invalid: true, jsonLdBlocks: [], nuxtPayload: null })
  let elements
  try {
    const scanned = scanOfflineRetailerMarkup(html, { includeScripts: true })
    // The standalone JSON-LD/Nuxt evidence reader may be called outside the
    // capture path. It must enforce the same source-retention and UTF-8
    // directives, or it could turn a denied HTML page into price evidence.
    if (scanned.hasMetaRefresh || scanned.hasMetaNoStore ||
        scanned.hasMetaNoArchive || scanned.hasConflictingCharset) return invalid()
    // Direct parsing of HTML with authoritative page identity must carry a
    // source URL. Otherwise no caller can prove the base/canonical belongs
    // to the retailer, even if the embedded Product JSON looks plausible.
    if (sourceUrl === undefined &&
        (scanned.baseHrefs.length || scanned.canonicalHrefs.length))
      return invalid()
    // Reuse the exact source/canonical identity validator of selector replay.
    // A same-host canonical for another SKU is NOT the captured price page.
    if (sourceUrl !== undefined) {
      if (typeof sourceUrl !== 'string') return invalid()
      try {
        const source = new URL(sourceUrl)
        if (source.protocol !== 'https:' || source.href !== sourceUrl ||
            source.username || source.password || source.port ||
            source.search || source.hash) return invalid()
        assertObservedRetailerHtmlIdentity(sourceUrl,
          scanned.baseHrefs,scanned.canonicalHrefs)
      } catch { return invalid() }
    }
    elements = scanned.scripts
  } catch { return invalid() }
  if (elements.length > MAX_SCRIPT_TAGS) return invalid()
  const jsonLdBlocks = []
  let nuxtPayload = null
  let nuxtSeen = false
  let count = 0
  for (const element of elements) {
    if (++count > MAX_SCRIPT_TAGS || element.rawAttributeLength > 1500) return invalid()
    const attr = element.attrs
    if ([...attr.values()].some(value => typeof value === 'string' && value.length > 256)) return invalid()
    const type = attr.get('type')?.trim().toLowerCase()
    const id = attr.get('id')
    const content = element.content.trim()
    // Never use remote script-src content as embedded structured evidence.
    if (attr.has('src')) {
      if (type === 'application/ld+json' || id === '__NUXT_DATA__') return invalid()
      continue
    }
    if (type === 'application/ld+json') {
      if (Buffer.byteLength(content, 'utf8') > MAX_SCRIPT_BYTES ||
          jsonLdBlocks.length >= MAX_JSONLD) return invalid()
      try {
        // The shared bounded decoder rejects duplicates, including Unicode-
        // escaped aliases, before any Product/Offer price is considered.
        const owned = parseUniqueKeyRetailerJson(content)
        jsonLdBlocks.push(JSON.parse(JSON.stringify(owned), (key, value) =>
          key === '@type' ? normalizeKnownSchemaType(value) : value))
      } catch { return invalid() }
    }
    if (id === '__NUXT_DATA__') {
      if (nuxtSeen || (type !== undefined &&
          type !== 'application/json') ||
          Buffer.byteLength(content, 'utf8') > MAX_SCRIPT_BYTES) return invalid()
      nuxtSeen = true
      try {
        const parsed = parseUniqueKeyRetailerJson(content)
        if (!Array.isArray(parsed) || parsed.length > 25000) return invalid()
        nuxtPayload = parsed
      } catch { return invalid() }
    }
  }
  return { invalid: false, jsonLdBlocks, nuxtPayload }
}
