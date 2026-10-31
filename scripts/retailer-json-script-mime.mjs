/**
 * Shared exact MIME admission for source-bound JSON script evidence.
 * A missing type stays absent for historical Nuxt/Next compatibility.
 * A present ambiguous/unsupported JSON MIME fails closed.
 */
// HTML parses character references in type attributes before deciding a
// script's data MIME type. Decode each reference ONCE; nested encodings,
// unknown names, malformed numbers and non-ASCII controls are not evidence.
function browserScriptMime(raw) {
  let invalid = false
  const names = { semi: ';', equals: '=', quot: '"', apos: "'", sol: '/', plus: '+', period: '.', colon: ':', lowbar: '_', num: '#', Tab: '\t', NewLine: '\n' }
  // Numeric references may omit the semicolon in an actual HTML attribute.
  // Never greedily accept a prefix of an oversized numeric reference, or
  // decode its output twice. Only printable ASCII is MIME/script-id evidence.
  const decoded = raw.replace(/&(?:#(?:[xX]([0-9a-fA-F]{1,6})(?![0-9a-fA-F])|([0-9]{1,7})(?![0-9]))(;?)|([a-z][a-z0-9]*)(;?))/gi,
    (whole, hex, dec, _numericTerminator, name, nameTerminator) => {
      if (name !== undefined) {
        if (nameTerminator !== ';' || !Object.hasOwn(names, name)) { invalid = true; return whole }
        return names[name]
      }
      const code = Number.parseInt(hex ?? dec, hex === undefined ? 10 : 16)
      if (!Number.isSafeInteger(code) || code < 32 || code > 126) { invalid = true; return whole }
      return String.fromCharCode(code)
    })
  return invalid || decoded.includes('&') ? null : decoded
}

// HTML also decodes character references in the id attribute. A disguised
// Nuxt/Next id must be counted as the same physical script; never silently
// miss a duplicate payload or lose its independent source evidence.
export function admittedRetailerScriptId(raw) {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || raw.length > 256) return null
  const decoded = browserScriptMime(raw)
  return decoded !== null && decoded.length <= 256 ? decoded : null
}

export function admittedJsonScriptType(raw) {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') return null
  const normalized = browserScriptMime(raw)
  // Browser-irrelevant text/*, module, and JavaScript script tags should
  // not veto a legitimate Product JSON block elsewhere on the same page.
  // Any malformed JSON-looking application/* type still fails closed.
  if (normalized === null) {
    const rawType = raw.trim().toLowerCase()
    return rawType.startsWith('application') || rawType.includes('ld+json')
      ? null : rawType
  }
  const type = normalized.trim().toLowerCase()
  if (!type.startsWith('application/ld+json') &&
      !type.startsWith('application/json')) return type
  const match = /^(application\/(?:ld\+json|json))(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"|'utf-8'))?$/.exec(type)
  return match ? match[1] : null
}
