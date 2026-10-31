// Shared offline/live retailer source route interpretation guard. A captured
// source and its proposed product anchor must not disagree about encoded path
// separators, dot segments, repeated decoding or control-byte interpretation.
const AMBIGUOUS = /%(?:2f|5c|2e|25|0[0-9a-f]|1[0-9a-f]|7f)/i
export function ambiguousRetailerRoute(path) {
  return typeof path !== 'string' || AMBIGUOUS.test(path) || path.includes('\\')
}

// One approved M1 path contract for both fresh HTTP captures and historical
// SHA-pinned offline source replay. Never infer rights from the URL itself.
const SOURCE_PATHS = Object.freeze({
  plus: Object.freeze({ product:'/product/', catalog:'/producten/', offers:'/aanbiedingen/' }),
  dekamarkt: Object.freeze({ product:'/producten/', catalog:'/producten/', offers:'/aanbiedingen/' }),
})
export function isAllowedM1RetailerSourcePath(retailerId,kind,path) {
  const routes=Object.hasOwn(SOURCE_PATHS,retailerId) ? SOURCE_PATHS[retailerId] : null
  const prefix=routes && Object.hasOwn(routes,kind) ? routes[kind] : null
  if (!prefix || ambiguousRetailerRoute(path)) return false
  if (kind!=='product' && (path===prefix.slice(0,-1) || path===prefix)) return true
  return path.startsWith(prefix) && path.length>prefix.length &&
    path[prefix.length]!=='/'
}

// Shared raw source identity for live capture and offline replay.
export function exactRawRetailerAuthority(raw, target) {
  // WHATWG trims leading ASCII spaces and strips tabs/CR/LF, then
  // normalizes percent-encoded authority. Do not skip raw-host validation
  // just because an alias has leading whitespace.
  if (/[\x00-\x20\x7f]/.test(raw)) return false
  // With a base URL, WHATWG resolves `https:producten` and
  // `https:/producten` as same-origin relative URLs. They must not pass as
  // literal audited HTTPS source authority references.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https:\/\//i.test(raw)) return false
  const match = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/i.exec(raw)
  return !match || match[1].toLowerCase() === new URL(target).host.toLowerCase()
}

export function validateObservedRetailerDocumentIdentity(target, baseHrefs, canonicalHrefs) {
  const expected = new URL(target)
  let documentBaseUrl = target
  for (const href of baseHrefs) {
    // The browser resolves HTML character references before interpreting
    // href. Never validate their undecoded source text as a safe URL.
    if (typeof href !== 'string' || !href || href.length > 2048 || (href.includes('&') || ambiguousRetailerRoute(href) ||
        !exactRawRetailerAuthority(href, target))) {
      throw new Error('Untrusted HTML base URL')
    }
    let destination
    try { destination = new URL(href, target) }
    catch { throw new Error('Untrusted HTML base URL') }
    // A same-origin <base> can still silently redirect relative product-card
    // links to another SKU, storefront or filtered listing. Accept only the
    // current document, its containing directory or the retailer root.
    // Browsers also use query/fragment from <base>, neither is a reviewed
    // source identity for this one-URL capture grant.
    const parentPath = expected.pathname.slice(0, expected.pathname.lastIndexOf('/') + 1)
    const basePath = destination.pathname
    if (destination.origin !== expected.origin || destination.username ||
        destination.password || destination.protocol !== 'https:' ||
        destination.search || destination.hash ||
        (basePath !== '/' && basePath !== parentPath &&
         basePath !== expected.pathname)) {
      throw new Error('Untrusted HTML base URL')
    }
    documentBaseUrl = destination.href
  }
  for (const href of canonicalHrefs) {
    if (typeof href !== 'string' || !href || href.length > 2048 || (href.includes('&') || ambiguousRetailerRoute(href) ||
        !exactRawRetailerAuthority(href, target))) {
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
  return documentBaseUrl
}
