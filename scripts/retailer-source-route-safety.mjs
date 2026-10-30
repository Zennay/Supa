// Shared offline/live retailer source route interpretation guard. A captured
// source and its proposed product anchor must not disagree about encoded path
// separators, dot segments, repeated decoding or control-byte interpretation.
const AMBIGUOUS = /%(?:2f|5c|2e|25|0[0-9a-f]|1[0-9a-f]|7f)/i
export function ambiguousRetailerRoute(path) {
  return typeof path !== 'string' || AMBIGUOUS.test(path) || path.includes('\\')
}
