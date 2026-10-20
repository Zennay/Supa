import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { SOURCES, validateSources } from './m1-capture-sources.mjs'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'

const MAX_HTML_BYTES = 2 * 1024 * 1024

/**
 * Network boundary for source-approved collection only. Disabled by default.
 * No public proxy use, circumvention, cookie/auth transport, recursive crawling,
 * redirects or automatic retries (especially not on HTTP 403/429).
 */
export async function fetchAuthorizedRetailerHtml({
  sourceId,
  permissionDocument,
  enableLive = false,
  fetchImpl = fetch,
  capturedAtMs = Date.now(),
  maxBytes = MAX_HTML_BYTES,
}) {
  if (enableLive !== true) throw new Error('Live collection is disabled')
  if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs < 0 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_HTML_BYTES) {
    throw new Error('Invalid collection limits')
  }
  // Real fetch cannot trust a caller-created in-memory "permission" object.
  // Load the repo's canonical reviewed rights register and require an explicit
  // operator switch. Injected transports remain mockable for offline tests.
  const usingRealTransport = fetchImpl === fetch
  if (usingRealTransport && process.env.SUPA_LIVE_RETAILER_CAPTURE !== '1') {
    throw new Error('Live retailer capture requires operator activation')
  }
  const rights = usingRealTransport
    ? JSON.parse(await readFile('evidence/m1/source-permission-gate.v1.json', 'utf8'))
    : permissionDocument
  const gate = evaluateSourcePermissionGate(rights)
  if (!gate.productionReady) throw new Error('Retailer permission not granted')
  const source = SOURCES.find((entry) => entry.id === sourceId)
  if (!source) throw new Error('Source is not in the pinned allowlist')
  validateSources([source])

  const response = await fetchImpl(source.url, {
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(12000),
    headers: {
      accept: 'text/html',
      'accept-language': 'nl-NL,nl;q=0.9',
      'user-agent': 'SUPA-authorized-catalog/0.1 (+https://github.com/Zennay/Supa)',
    },
  })
  if (!response || response.url !== source.url || !response.ok ||
      response.status === 403 || response.status === 429) {
    throw new Error('Authorized retailer response unavailable')
  }
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers?.get?.('content-type') ?? '')) {
    throw new Error('Authorized response is not HTML')
  }
  const declared = response.headers?.get?.('content-length')
  if (declared !== null && declared !== undefined &&
      (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new Error('Authorized response exceeds byte limit')
  }
  if (!response.body?.getReader) {
    throw new Error('Bounded response streaming is required')
  }

  const reader = response.body.getReader()
  const parts = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('Invalid HTML bytes')
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error('Authorized response exceeds byte limit')
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const html = Buffer.concat(parts).toString('utf8')
  return {
    source: { ...source },
    capturedAt: new Date(capturedAtMs).toISOString(),
    sha256: createHash('sha256').update(Buffer.concat(parts)).digest('hex'),
    bytes,
    html,
  }
}
