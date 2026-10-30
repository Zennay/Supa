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


// CSS/template fallback markup and HTML comments are never executable product
// evidence. Prefer an explicit refusal to trusting hidden or malformed data.
function visibleStructuredScripts(html) {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '')
  if (stripped.includes('<!--') || stripped.includes('-->')) return null
  let markup = stripped
  for (const tag of ['template', 'noscript', 'textarea', 'svg', 'style', 'title', 'xmp', 'iframe']) {
    const opening = new RegExp('<' + tag + '\\b', 'gi')
    const closing = new RegExp('<\\/' + tag + '\\s*>', 'gi')
    const beforeOpen = [...markup.matchAll(opening)].length
    const beforeClose = [...markup.matchAll(closing)].length
    if (beforeOpen !== beforeClose) return null
    const pair = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi')
    markup = markup.replace(pair, '')
    if (opening.test(markup) || closing.test(markup)) return null
  }
  return markup
}


// Scan actual HTML opening tags, not a '<script>' string inside a quoted
// attribute of another element. Script text is raw until its closing tag.
function scriptElements(markup) {
  const scripts = []
  let pos = 0
  while (pos < markup.length) {
    const start = markup.indexOf('<', pos)
    if (start < 0) break
    const token = /^<\/?([a-z][a-z0-9-]*)\b/i.exec(markup.slice(start))
    if (!token) { pos = start + 1; continue }
    const isClose = markup[start + 1] === '/'
    let quote = null
    let end = -1
    for (let i = start + token[0].length; i < markup.length; i++) {
      const ch = markup[i]
      if (quote) { if (ch === quote) quote = null }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') { end = i; break }
      else if (ch === '<') return null
    }
    if (end < 0) return null
    pos = end + 1
    if (token[1].toLowerCase() !== 'script') continue
    if (isClose) return null
    const closer = /<\/script\s*>/gi
    closer.lastIndex = pos
    const found = closer.exec(markup)
    if (!found) return null
    scripts.push({
      attrs: markup.slice(start + token[0].length, end),
      content: markup.slice(pos, found.index),
    })
    if (scripts.length > MAX_SCRIPT_TAGS) return null
    pos = closer.lastIndex
  }
  return scripts
}

export function readAuthorizedHtmlScriptEvidence(html) {
  if (typeof html !== 'string' ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return { invalid: true, jsonLdBlocks: [], nuxtPayload: null }
  }
  const invalid = () => ({ invalid: true, jsonLdBlocks: [], nuxtPayload: null })
  const visible = visibleStructuredScripts(html)
  if (visible === null) return invalid()
  const elements = scriptElements(visible)
  if (elements === null) return invalid()
  const jsonLdBlocks = []
  let nuxtPayload = null
  let nuxtSeen = false
  let count = 0
  for (const element of elements) {
    if (++count > MAX_SCRIPT_TAGS || element.attrs.length > 1500) return invalid()
    const attr = attributes(element.attrs)
    if (!attr) return invalid()
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
        jsonLdBlocks.push(JSON.parse(content))
      } catch { return invalid() }
    }
    if (id === '__NUXT_DATA__') {
      if (nuxtSeen || (type !== undefined &&
          type !== 'application/json' && type !== 'application/ld+json') ||
          Buffer.byteLength(content, 'utf8') > MAX_SCRIPT_BYTES) return invalid()
      nuxtSeen = true
      try {
        const parsed = JSON.parse(content)
        if (!Array.isArray(parsed) || parsed.length > 25000) return invalid()
        nuxtPayload = parsed
      } catch { return invalid() }
    }
  }
  return { invalid: false, jsonLdBlocks, nuxtPayload }
}
