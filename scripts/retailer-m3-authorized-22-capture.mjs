/**
 * M3: eleven identical ingredient demands, two retailer catalog sources.
 *
 * The transport is deliberately permission gated and off by default. The
 * parser/comparator may also be exercised with injected, synthetic responses,
 * but those responses never constitute evidence of a real retailer price.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { canonicalM3RetailerRequirements } from './retailer-canonical-m3-demand.mjs'
import { parseOfflineRetailerSnapshot } from './retailer-snapshot-adapters.mjs'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024
const STORES = ['plus', 'dekamarkt']
const HOSTS = { plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' }

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function allowedProductUrl(value, store) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === HOSTS[store] &&
      url.origin === 'https://' + HOSTS[store] &&
      url.username === '' && url.password === '' && url.port === '' &&
      url.search === '' && url.hash === '' &&
      (store === 'plus' ? url.pathname.startsWith('/product/') :
        url.pathname.startsWith('/producten/')) &&
      url.pathname.length > (store === 'plus' ? 9 : 11)
  } catch {
    return false
  }
}

/**
 * Validate the FULL 11x2 intent before requesting even one retailer URL.
 * Multiple ingredients can use one product page, but it is fetched only once.
 */
export function validateM3RetailerCapturePlan(plan) {
  const requirements = canonicalM3RetailerRequirements()
  assert(plan?.version === 1 && Array.isArray(plan.products) &&
    plan.products.length === requirements.length * 2,
    'M3 capture plan requires exactly 11 assignments per retailer')
  const allowedIds = new Set(requirements.map((line) => line.id))
  const assignments = new Map()
  const sources = new Map()
  for (const item of plan.products) {
    assert(item && typeof item === 'object' && !Array.isArray(item) &&
      STORES.includes(item.supermarket) && allowedIds.has(item.ingredientId) &&
      allowedProductUrl(item.url, item.supermarket),
    'Invalid M3 retailer product assignment')
    const key = item.supermarket + ':' + item.ingredientId
    assert(!assignments.has(key), 'Duplicate M3 retailer ingredient assignment')
    assignments.set(key, item.url)
    // Same physical SKU may cover several ingredient IDs. One HTTP fetch,
    // one observation and one source identity per URL avoids double counting.
    sources.set(item.supermarket + ':' + item.url, {
      supermarket: item.supermarket,
      url: item.url,
      kind: 'product',
    })
  }
  for (const line of requirements) {
    for (const store of STORES) {
      assert(assignments.has(store + ':' + line.id),
        'Missing M3 retailer ingredient assignment')
    }
  }
  assert(sources.size <= 22 && sources.size >= 2,
    'Invalid bounded M3 retailer source set')
  return { requirements, sources: [...sources.values()] }
}

function validClock(ms) {
  return Number.isSafeInteger(ms) && ms >= 0
}

async function cancelBody(response) {
  try { await response?.body?.cancel?.('untrusted retailer response') } catch {}
}

/**
 * One bounded, anonymous request. Never follow redirects, send credentials,
 * use a proxy, retry 403/429, or silently substitute invalid UTF-8.
 */
async function captureOneProduct(source, fetchImpl, capturedAtMs) {
  const response = await fetchImpl(source.url, {
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(12_000),
    headers: {
      accept: 'text/html',
      'accept-language': 'nl-NL,nl;q=0.9',
      'user-agent': 'SUPA-authorized-basket/0.1 (+https://github.com/Zennay/Supa)',
    },
  })
  if (!response || response.url !== source.url || !response.ok ||
      response.status === 403 || response.status === 429 ||
      !/^text\/html(?:\s*;|$)/i.test(response.headers?.get?.('content-type') ?? '')) {
    await cancelBody(response)
    throw new Error('Authorized M3 source response refused')
  }
  const declared = response.headers?.get?.('content-length')
  if (declared != null &&
      (!/^\d+$/.test(declared) || Number(declared) > MAX_CAPTURE_BYTES)) {
    await cancelBody(response)
    throw new Error('Authorized M3 source exceeds byte limit')
  }
  if (!response.body?.getReader) {
    await cancelBody(response)
    throw new Error('Authorized M3 source must stream bounded HTML')
  }

  const reader = response.body.getReader()
  let completed = false
  let length = 0
  const buffers = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        completed = true
        break
      }
      if (!(value instanceof Uint8Array)) throw new Error('Invalid retailer HTML chunk')
      length += value.byteLength
      if (length > MAX_CAPTURE_BYTES) throw new Error('Authorized M3 source exceeds byte limit')
      buffers.push(Buffer.from(value))
    }
  } finally {
    if (!completed) {
      try { await reader.cancel('retailer response rejected') } catch {}
    }
    reader.releaseLock()
  }

  const bytes = Buffer.concat(buffers, length)
  let html
  try {
    html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error('Authorized retailer HTML has invalid UTF-8')
  }
  // Reject inconsistent byte-to-parser input (including unexpected BOM).
  if (!bytes.equals(Buffer.from(html, 'utf8'))) {
    throw new Error('Retailer bytes cannot be losslessly parsed')
  }
  return {
    source: {
      id: source.supermarket + '-m3-product-' +
        createHash('sha256').update(source.url).digest('hex').slice(0, 20),
      ...source,
    },
    capturedAt: new Date(capturedAtMs).toISOString(),
    bytes: length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    html,
  }
}

/**
 * One finite authorized M3 run. When real network fetch is used, a checked-in
 * source-rights document AND explicit operator switch are mandatory.
 * Injected mock fetch is strictly for test harnesses; it never grants rights.
 */
export async function captureAuthorizedM3RetailerBasket({
  plan,
  enableLive = false,
  fetchImpl = fetch,
  permissionDocument,
  nowMs = Date.now(),
}) {
  assert(validClock(nowMs), 'Invalid M3 capture reference clock')
  const { requirements, sources } = validateM3RetailerCapturePlan(plan)
  // Validate both source rights and the opt-in BEFORE any network I/O.
  assert(enableLive === true, 'M3 retailer capture is disabled')
  const usingRealNetwork = fetchImpl === fetch
  if (usingRealNetwork) {
    assert(process.env.SUPA_LIVE_RETAILER_CAPTURE === '1',
      'Explicit live retailer activation required')
  }
  const rights = usingRealNetwork
    ? JSON.parse(await readFile('evidence/m1/source-permission-gate.v1.json', 'utf8'))
    : permissionDocument
  const permission = evaluateSourcePermissionGate(rights)
  assert(permission.productionReady, 'Retailer permission not granted')
  // Check market demands through the actual comparator before any HTTP I/O.
  compareReviewedCatalogs({ requirements, observations: [], nowMs })

  const observations = []
  const captureSummary = []
  const seenPricedHashes = new Set()
  for (const source of sources) {
    const capture = await captureOneProduct(source, fetchImpl,
      usingRealNetwork ? Date.now() : nowMs)
    const parsed = parseOfflineRetailerSnapshot(capture)
    assert(parsed.provenance.sha256 === capture.sha256,
      'M3 captured HTML integrity mismatch')
    const hasPrice = parsed.observations.some((value) =>
      value.availability === 'available' &&
      Number.isSafeInteger(value.currentPriceCents) &&
      value.currentPriceCents >= 0)
    if (hasPrice) {
      assert(!seenPricedHashes.has(capture.sha256),
        'Repeated priced retailer capture refused')
      seenPricedHashes.add(capture.sha256)
    }
    observations.push(...parsed.observations)
    captureSummary.push({
      supermarket: source.supermarket,
      sourceId: capture.source.id,
      capturedAt: capture.capturedAt,
      sha256: capture.sha256,
      bytes: capture.bytes,
      parsedProducts: parsed.observations.length,
      rejected: parsed.rejected,
    })
  }
  return {
    provenance: usingRealNetwork ? 'authorized-retailer-capture-preview' :
      'synthetic-test-transport-preview',
    claimable: false,
    sourcePermissionReady: permission.productionReady,
    requiredIngredientCount: requirements.length,
    capturedSourceCount: captureSummary.length,
    captureSummary,
    comparison: compareReviewedCatalogs({
      requirements,
      observations,
      nowMs: usingRealNetwork ? Date.now() : nowMs,
    }),
    warning: 'Preview only; not independently verified checkout evidence or a public savings claim',
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 2 && argv[0] === '--template') {
    const destination = argv[1]
    assert(typeof destination === 'string' && destination.trim() &&
      destination === destination.trim() && !destination.startsWith('-'),
      'A new private M3 template path is required')
    const requirements = canonicalM3RetailerRequirements()
    const template = {
      version: 1,
      products: STORES.flatMap((supermarket) =>
        requirements.map(({ id: ingredientId, query }) => ({
          supermarket, ingredientId, query, url: '',
        }))),
    }
    // Exclusive creation: never overwrite a genuine private operator draft.
    await writeFile(destination, JSON.stringify(template, null, 2) + '\\n',
      { flag: 'wx', mode: 0o600 })
    process.stdout.write('Private canonical M3 URL plan created; enter only authorized product URLs\\n')
    return template
  }
  assert(argv.length === 2 && argv[0] === '--live' &&
    typeof argv[1] === 'string' && argv[1] &&
    !argv[1].startsWith('-'),
    'Usage: node --experimental-strip-types scripts/retailer-m3-authorized-22-capture.mjs --live <private-product-plan.json>')
  const plan = JSON.parse(await readFile(argv[1], 'utf8'))
  const result = await captureAuthorizedM3RetailerBasket({ plan, enableLive: true })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('M3 retailer collection refused: check source rights, opt-in, input and response integrity')
    process.exitCode = 1
  })
}
