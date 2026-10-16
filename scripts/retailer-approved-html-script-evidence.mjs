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

function attributes(text) {
  const result = new Map()
  let pos = 0
  let count = 0
  while (pos < text.length) {
    while (/\s/.test(text[pos] ?? '')) pos++
    if (pos === text.length) break
    if (text[pos] === '/' && !text.slice(pos + 1).trim()) break
    const rest = text.slice(pos)
    const name = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(rest)?.[0]
    if (!name || ++count > 64) return null
    pos += name.length
    const key = name.toLowerCase()
    // Duplicate authoritative fields are ambiguous, including case variants.
    if (result.has(key)) return null
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
        const match = /^[^\s<>=\x60"']+/.exec(text.slice(pos))
        if (!match) return null
        value = match[0]
        pos += match[0].length
      }
      if (value.length > 256) return null
    }
    result.set(key, value)
  }
  return result
}

// JSON.parse keeps the final occurrence of an object key, erasing source
// contradictions (e.g. two Offer.price or Product.url values). Check decoded
// keys at every object depth before accepting even private JSON-LD evidence.
// This scanner only identifies tokens; JSON.parse still validates full syntax.
function parseUniqueJson(source) {
  const frames = []
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"') {
      const first = index
      index++
      for (; index < source.length; index++) {
        if (source[index] === '\\') {
          index++ // The next UTF-16 code unit is escaped, including a quote.
        } else if (source[index] === '"') {
          break
        }
      }
      if (index >= source.length) throw new Error('invalid JSON string')
      let next = index + 1
      while (/\s/u.test(source[next] ?? '')) next++
      if (source[next] === ':' && frames.at(-1)?.kind === 'object') {
        const decodedKey = JSON.parse(source.slice(first, index + 1))
        const keys = frames.at(-1).keys
        if (keys.has(decodedKey)) throw new Error('duplicate JSON object key')
        keys.add(decodedKey)
      }
    } else if (char === '{') {
      frames.push({ kind: 'object', keys: new Set() })
    } else if (char === '[') {
      frames.push({ kind: 'array' })
    } else if (char === '}' || char === ']') {
      frames.pop()
    }
  }
  return JSON.parse(source)
}

// Comments and inert template/RCDATA contents are not active script nodes.
// Mask those regions BEFORE the bounded script-tag scanner. Masking rather
// than deleting keeps safe tag boundaries separated and avoids promoting
// script-looking text from inside an HTML comment or a <template>.
// This is deliberately conservative: malformed/incomplete inert blocks
// cannot contribute source-price evidence.
function maskInertHtml(html) {
  const tokens = /<!--[\s\S]*?(?:-->|$)|<\/?(?:template|textarea|title|noscript)\b[^>]*>/gi
  let masked = ''
  let cursor = 0
  const contexts = []
  for (const match of html.matchAll(tokens)) {
    const start = match.index
    masked += contexts.length ? ' '.repeat(start - cursor) : html.slice(cursor, start)
    const token = match[0]
    masked += ' '.repeat(token.length)
    cursor = start + token.length
    if (token.startsWith('<!--')) continue
    const close = /^<\//u.test(token)
    const name = /^<\/?(template|textarea|title|noscript)\b/iu.exec(token)?.[1]?.toLowerCase()
    if (!name) continue
    const active = contexts.at(-1)
    if (!active) {
      if (!close) contexts.push(name)
    } else if (close && active === name) {
      contexts.pop()
    } else if (!close && active === 'template') {
      // Nested templates and RCDATA inside a template stay inert until
      // their matching enclosing end tag; other markup is simply ignored.
      contexts.push(name)
    }
  }
  masked += contexts.length ? ' '.repeat(html.length - cursor) : html.slice(cursor)
  return masked
}

export function readAuthorizedHtmlScriptEvidence(html) {
  if (typeof html !== 'string' ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return { invalid: true, jsonLdBlocks: [], nuxtPayload: null }
  }
  const invalid = () => ({ invalid: true, jsonLdBlocks: [], nuxtPayload: null })
  const jsonLdBlocks = []
  let nuxtPayload = null
  let nuxtSeen = false
  let count = 0
  const scriptPattern = /<script\b([^<>]{0,1500})>([\s\S]*?)<\/script\s*>/gi
  for (const match of maskInertHtml(html).matchAll(scriptPattern)) {
    if (++count > MAX_SCRIPT_TAGS) return invalid()
    const attr = attributes(match[1])
    if (!attr) return invalid()
    const type = attr.get('type')?.trim().toLowerCase()
    const id = attr.get('id')
    const content = match[2].trim()
    // Never use remote script-src content as embedded structured evidence.
    if (attr.has('src')) continue
    if (type === 'application/ld+json') {
      if (Buffer.byteLength(content, 'utf8') > MAX_SCRIPT_BYTES ||
          jsonLdBlocks.length >= MAX_JSONLD) return invalid()
      try {
        jsonLdBlocks.push(parseUniqueJson(content))
      } catch { return invalid() }
    }
    if (id === '__NUXT_DATA__') {
      if (nuxtSeen || (type !== undefined &&
          type !== 'application/json' && type !== 'application/ld+json') ||
          Buffer.byteLength(content, 'utf8') > MAX_SCRIPT_BYTES) return invalid()
      nuxtSeen = true
      try {
        const parsed = parseUniqueJson(content)
        if (!Array.isArray(parsed) || parsed.length > 25000) return invalid()
        nuxtPayload = parsed
      } catch { return invalid() }
    }
  }
  return { invalid: false, jsonLdBlocks, nuxtPayload }
}
