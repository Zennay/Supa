import { createHash } from 'node:crypto'
import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'
import { validateSources } from './m1-capture-sources.mjs'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_SCRIPTS = 100

/** Interpret only genuine Script[type] attributes, not data-type/quoted text. */
function isJsonLdScript(attrs) {
  let rest = attrs
  let type = null
  while (rest.trim()) {
    const attribute = /^\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/.exec(rest)
    if (!attribute) return false
    if (attribute[1].toLowerCase() === 'type') {
      if (type !== null) return false // duplicate type is ambiguous
      type = attribute[2] ?? attribute[3] ?? attribute[4] ?? ''
    }
    rest = rest.slice(attribute[0].length)
  }
  return type?.trim().toLowerCase() === 'application/ld+json'
}

/**
 * Offline-only JSON-LD ingestion from a user-supplied / previously authorized
 * HTML snapshot. SSR Nuxt and rendered PLUS listing evidence continue to use
 * their dedicated source-specific parsers; no network access occurs here.
 */
export function parseOfflineRetailerSnapshot({ source, html, capturedAt }) {
  validateSources([source])
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_BYTES ||
      typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) {
    throw new Error('Invalid bounded offline snapshot')
  }
  const sha256 = createHash('sha256').update(html).digest('hex')
  const provenance = {
    supermarket: source.supermarket, kind: source.kind, url: source.url,
    capturedAt, sha256,
  }
  const observations = []
  const failures = []
  let count = 0
  // HTML comments are not active DOM scripts. Never accept their prices.
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const match of activeHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!isJsonLdScript(match[1])) continue
    count += 1
    if (count > MAX_SCRIPTS) throw new Error('Too many JSON-LD scripts')
    if (Buffer.byteLength(match[2], 'utf8') > 256 * 1024) {
      failures.push('json_ld_too_large')
      continue
    }
    let node
    try {
      node = JSON.parse(match[2])
    } catch {
      failures.push('invalid_json_ld')
      continue
    }
    const value = parseSchemaOrgProduct(node, provenance)
    if (value.type === 'observation') observations.push(value.observation)
    else failures.push('no_unambiguous_product')
  }
  return { provenance, observations, rejected: failures.length,
    scriptsInspected: count, reason: count === 0 ? 'no_json_ld' : null }
}
