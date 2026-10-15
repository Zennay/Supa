// Structured-data extraction from retailer HTML. Every Dutch retailer we
// target embeds its product data in one of these containers, so adapters
// never have to rely on fragile CSS selectors:
//   - <script type="application/ld+json"> (schema.org Product)
//   - <script id="__NEXT_DATA__"> (Next.js)
//   - <script id="__NUXT_DATA__"> (Nuxt 3 / devalue payload)
//   - window.__NUXT__=(function(a,b,...){return {...}}(...)) (Nuxt 2)

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi

export function scripts(html) {
  const out = []
  for (const m of String(html).matchAll(SCRIPT_RE)) out.push({ attrs: m[1], body: m[2] })
  return out
}

function tryJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    try {
      // Some sites leave raw control characters inside strings.
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '))
    } catch {
      return undefined
    }
  }
}

export function decodeHtmlEntities(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

export function jsonLdBlocks(html) {
  const out = []
  for (const { attrs, body } of scripts(html)) {
    if (!/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) continue
    const parsed = tryJson(body.trim())
    if (parsed !== undefined) out.push(parsed)
  }
  return out
}

function hasType(node, type) {
  const t = node?.['@type']
  return Array.isArray(t) ? t.includes(type) : t === type
}

export function jsonLdProducts(html) {
  const products = []
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    if (hasType(node, 'Product')) products.push(node)
    if (node['@graph']) visit(node['@graph'])
  }
  jsonLdBlocks(html).forEach(visit)
  return products
}

export function nextData(html) {
  for (const { attrs, body } of scripts(html)) {
    if (/id\s*=\s*["']__NEXT_DATA__["']/.test(attrs)) return tryJson(body)
  }
  return undefined
}

// --- Nuxt 3 (devalue) payload -------------------------------------------

const DEVALUE_WRAPPERS = new Set([
  'Reactive',
  'ShallowReactive',
  'Ref',
  'ShallowRef',
  'EmptyRef',
  'EmptyShallowRef',
  'NuxtError',
  'Island',
])

export function resolveDevalue(table) {
  if (!Array.isArray(table)) return undefined
  const cache = new Map()

  const resolve = (index) => {
    if (index === -1) return undefined
    if (index === -2) return null
    if (index === -3) return NaN
    if (index === -4) return Infinity
    if (index === -5) return -Infinity
    if (index === -6) return -0
    if (cache.has(index)) return cache.get(index)
    const raw = table[index]
    if (raw === null || typeof raw !== 'object') {
      cache.set(index, raw)
      return raw
    }
    if (Array.isArray(raw)) {
      if (typeof raw[0] === 'string') {
        const tag = raw[0]
        if (DEVALUE_WRAPPERS.has(tag)) {
          const value = raw.length > 1 ? resolve(raw[1]) : undefined
          cache.set(index, value)
          return value
        }
        if (tag === 'Date') return new Date(raw[1])
        if (tag === 'Set') {
          const set = []
          cache.set(index, set)
          for (const i of raw.slice(1)) set.push(resolve(i))
          return set
        }
        if (tag === 'Map') {
          const map = {}
          cache.set(index, map)
          for (let i = 1; i < raw.length; i += 2) map[String(resolve(raw[i]))] = resolve(raw[i + 1])
          return map
        }
        if (tag === 'null') {
          const obj = Object.create(null)
          cache.set(index, obj)
          for (let i = 1; i < raw.length; i += 2) obj[raw[i]] = resolve(raw[i + 1])
          return obj
        }
        if (tag === 'BigInt') return raw[1]
        if (tag === 'RegExp') return raw[1]
      }
      const arr = []
      cache.set(index, arr)
      for (const i of raw) arr.push(typeof i === 'number' ? resolve(i) : i)
      return arr
    }
    const obj = {}
    cache.set(index, obj)
    for (const [k, v] of Object.entries(raw)) obj[k] = typeof v === 'number' ? resolve(v) : v
    return obj
  }

  return resolve(0)
}

export function nuxtData(html) {
  for (const { attrs, body } of scripts(html)) {
    if (/id\s*=\s*["']__NUXT_DATA__["']/.test(attrs)) {
      const table = tryJson(body)
      return table === undefined ? undefined : resolveDevalue(table)
    }
  }
  return undefined
}

// --- Nuxt 2 IIFE payload ---------------------------------------------------
// We do NOT execute retailer JavaScript. Instead we parse the JS literal
// subset that Nuxt 2 emits and resolve the IIFE parameters ourselves.

class LiteralParser {
  constructor(src, env = {}) {
    this.src = src
    this.i = 0
    this.env = env
  }

  ws() {
    const s = this.src
    while (this.i < s.length) {
      const c = s[this.i]
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') this.i += 1
      else if (c === '/' && s[this.i + 1] === '*') {
        const end = s.indexOf('*/', this.i + 2)
        this.i = end < 0 ? s.length : end + 2
      } else break
    }
  }

  peek() {
    this.ws()
    return this.src[this.i]
  }

  expect(ch) {
    if (this.peek() !== ch) throw new Error(`expected ${ch} at ${this.i}`)
    this.i += 1
  }

  string() {
    const s = this.src
    const quote = s[this.i]
    this.i += 1
    let out = ''
    while (this.i < s.length) {
      const c = s[this.i]
      if (c === quote) {
        this.i += 1
        return out
      }
      if (c === '\\') {
        const n = s[this.i + 1]
        this.i += 2
        if (n === 'u') {
          if (s[this.i] === '{') {
            const end = s.indexOf('}', this.i)
            out += String.fromCodePoint(parseInt(s.slice(this.i + 1, end), 16))
            this.i = end + 1
          } else {
            out += String.fromCharCode(parseInt(s.slice(this.i, this.i + 4), 16))
            this.i += 4
          }
        } else if (n === 'x') {
          out += String.fromCharCode(parseInt(s.slice(this.i, this.i + 2), 16))
          this.i += 2
        } else {
          out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[n] ?? n
        }
        continue
      }
      out += c
      this.i += 1
    }
    throw new Error('unterminated string')
  }

  identifier() {
    this.ws()
    const m = /^[A-Za-z_$][\w$]*/.exec(this.src.slice(this.i, this.i + 64))
    if (!m) throw new Error(`unexpected ${this.src[this.i]} at ${this.i}`)
    this.i += m[0].length
    return m[0]
  }

  value() {
    const c = this.peek()
    if (c === '{') return this.object()
    if (c === '[') return this.array()
    if (c === '"' || c === "'") return this.string()
    if (c === '-' || c === '.' || (c >= '0' && c <= '9')) {
      const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.i, this.i + 40))
      if (!m) throw new Error(`bad number at ${this.i}`)
      this.i += m[0].length
      return Number(m[0])
    }
    if (c === '!') {
      this.i += 1
      return !this.value()
    }
    const id = this.identifier()
    if (id === 'true') return true
    if (id === 'false') return false
    if (id === 'null') return null
    if (id === 'undefined') return undefined
    if (id === 'void') {
      this.value()
      return undefined
    }
    if (id === 'new' || this.peek() === '(') {
      // Constructor/function call such as Array(3) or new Date(...): skip it.
      if (id === 'new') this.identifier()
      this.skipBalanced()
      return undefined
    }
    return Object.prototype.hasOwnProperty.call(this.env, id) ? this.env[id] : undefined
  }

  skipBalanced() {
    const open = this.peek()
    const close = { '(': ')', '[': ']', '{': '}' }[open]
    if (!close) return
    let depth = 0
    const s = this.src
    while (this.i < s.length) {
      const c = s[this.i]
      if (c === '"' || c === "'") {
        this.string()
        continue
      }
      if (c === '(' || c === '[' || c === '{') depth += 1
      if (c === ')' || c === ']' || c === '}') {
        depth -= 1
        if (depth === 0) {
          this.i += 1
          return
        }
      }
      this.i += 1
    }
  }

  object() {
    this.expect('{')
    const out = {}
    while (this.peek() !== '}') {
      const c = this.peek()
      let key
      if (c === '"' || c === "'") key = this.string()
      else if (c >= '0' && c <= '9') key = String(this.value())
      else key = this.identifier()
      if (this.peek() === ':') {
        this.i += 1
        out[key] = this.value()
      } else {
        out[key] = this.env[key]
      }
      if (this.peek() === ',') this.i += 1
    }
    this.i += 1
    return out
  }

  array() {
    this.expect('[')
    const out = []
    while (this.peek() !== ']') {
      if (this.peek() === ',') {
        out.push(undefined)
        this.i += 1
        continue
      }
      out.push(this.value())
      if (this.peek() === ',') this.i += 1
    }
    this.i += 1
    return out
  }
}

export function parseJsLiteral(src, env) {
  return new LiteralParser(src, env).value()
}

function skipStringAt(src, i) {
  const quote = src[i]
  i += 1
  while (i < src.length) {
    if (src[i] === '\\') i += 2
    else if (src[i] === quote) return i + 1
    else i += 1
  }
  return i
}

export function nuxt2State(html) {
  const marker = String(html).indexOf('window.__NUXT__=(function(')
  if (marker < 0) return undefined
  const src = html.slice(marker + 'window.__NUXT__='.length)
  const head = /^\(function\(([^)]*)\)\{/.exec(src)
  if (!head) return undefined
  const params = head[1].split(',').map((p) => p.trim()).filter(Boolean)

  // Locate the function body and its top-level `return`.
  let i = head[0].length
  let depth = 1
  let returnAt = -1
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (c === '"' || c === "'") {
      i = skipStringAt(src, i)
      continue
    }
    if (c === '{' || c === '[' || c === '(') depth += 1
    else if (c === '}' || c === ']' || c === ')') depth -= 1
    else if (
      depth === 1 &&
      returnAt < 0 &&
      src.startsWith('return', i) &&
      !/[\w$]/.test(src[i - 1]) &&
      !/[\w$]/.test(src[i + 6])
    ) {
      returnAt = i + 6
    }
    i += 1
  }
  if (returnAt < 0) return undefined

  // Parse the call arguments: `}(arg1,arg2,...))`
  const argParser = new LiteralParser(src)
  argParser.i = i
  if (argParser.peek() !== '(') return undefined
  argParser.i += 1
  const args = []
  while (argParser.peek() !== ')' && argParser.i < src.length) {
    args.push(argParser.value())
    if (argParser.peek() === ',') argParser.i += 1
  }
  const env = {}
  params.forEach((p, idx) => {
    env[p] = args[idx]
  })
  try {
    return new LiteralParser(src.slice(returnAt), env).value()
  } catch {
    return undefined
  }
}

// Generic deep search helper used by adapters.
export function findAll(root, predicate, limit = Infinity) {
  const out = []
  const seen = new Set()
  const stack = [root]
  while (stack.length && out.length < limit) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (!Array.isArray(node) && predicate(node)) out.push(node)
    const values = Array.isArray(node) ? node : Object.values(node)
    for (let k = values.length - 1; k >= 0; k -= 1) stack.push(values[k])
  }
  return out
}
