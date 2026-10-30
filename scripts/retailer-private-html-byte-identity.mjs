// One exact UTF-8 byte contract for source capture, human CLI inspection and
// historical SHA-pinned private replay. A browser can normalize malformed
// source bytes; do not silently hash something other than the inspected DOM.
export function decodeExactRetailerHtmlBytes(raw) {
  if (!(raw instanceof Uint8Array) || raw.byteLength < 1 ||
      raw.byteLength > 2 * 1024 * 1024) {
    throw new Error('Invalid or oversized retailer HTML bytes')
  }
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    throw new Error('Ambiguous HTML UTF-8 BOM refused')
  }
  const html = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  if (html.includes('\u0000') ||
      Buffer.byteLength(html, 'utf8') !== raw.byteLength ||
      !Buffer.from(html, 'utf8').equals(Buffer.from(raw))) {
    throw new Error('Ambiguous HTML source encoding refused')
  }
  return html
}
