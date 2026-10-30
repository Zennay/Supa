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
