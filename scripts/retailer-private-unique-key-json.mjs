/**
 * Strict JSON-LD document decoder for previously authorized, OFFLINE HTML.
 * JSON.parse silently uses the last duplicate object member. That is unsafe
 * for source URL, price, currency, stock, pack or nested provenance evidence.
 *
 * This scanner checks the decoded identity of every key before returning the
 * native JSON.parse result. It never fetches or publishes retail prices.
 */
const MAX_BYTES = 256 * 1024
const MAX_DEPTH = 64
const denied = () => { throw new Error('Unsafe or ambiguous offline JSON-LD') }

export function parseUniqueKeyRetailerJson(source) {
  if (typeof source !== 'string' ||
      Buffer.byteLength(source, 'utf8') > MAX_BYTES ||
      Buffer.from(source, 'utf8').toString('utf8') !== source) denied()

  // Native JSON grammar validation first, then duplicate-key verification.
  // Neither parser is allowed to return values before all nested keys pass.
  let parsed
  try { parsed = JSON.parse(source) } catch { denied() }

  let index = 0
  const skipSpace = () => {
    while (index < source.length && /[\x20\t\r\n]/.test(source[index])) index++
  }
  const readString = () => {
    if (source[index] !== '"') denied()
    const start = index++
    let escaped = false
    while (index < source.length) {
      const char = source[index++]
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '"') {
        try { return JSON.parse(source.slice(start, index)) }
        catch { denied() }
      }
    }
    denied()
  }
  const readValue = depth => {
    if (depth > MAX_DEPTH) denied()
    skipSpace()
    if (source[index] === '{') {
      index++
      const seen = new Set()
      skipSpace()
      if (source[index] === '}') { index++; return }
      for (;;) {
        skipSpace()
        const key = readString()
        if (seen.has(key)) denied()  // includes Unicode-escaped aliases
        seen.add(key)
        skipSpace()
        if (source[index++] !== ':') denied()
        readValue(depth + 1)
        skipSpace()
        const next = source[index++]
        if (next === '}') return
        if (next !== ',') denied()
      }
    }
    if (source[index] === '[') {
      index++
      skipSpace()
      if (source[index] === ']') { index++; return }
      for (;;) {
        readValue(depth + 1)
        skipSpace()
        const next = source[index++]
        if (next === ']') return
        if (next !== ',') denied()
      }
    }
    if (source[index] === '"') { readString(); return }
    // JSON.parse above already validated primitive grammar. Consume only
    // its original scalar token, without losing track of nested boundaries.
    const start = index
    while (index < source.length && !/[\x20\t\r\n,\]}]/.test(source[index])) index++
    if (start === index) denied()
  }

  readValue(0)
  skipSpace()
  if (index !== source.length) denied()
  return parsed
}
