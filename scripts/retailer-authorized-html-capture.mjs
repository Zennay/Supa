/**
 * Permission-gated bounded capture for ONE explicitly approved public retailer
 * HTML page. Unlike the M1 feasibility capture, this entrypoint refuses all
 * network access while either source lacks individual written rights.
 * No crawling, discovered links, private APIs, login, proxy or bot-bypass.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SOURCES } from './m1-capture-sources.mjs'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'

const HOSTS = Object.freeze({ plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' })
const PAGE_KINDS = new Set(['product', 'catalog', 'offers'])
const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15000

function refuse() { throw new Error('Retailer HTML capture refused by source authorization or bounded transport policy') }
function safeSource(source) {
  if (!source || typeof source !== 'object' ||
      !Object.hasOwn(HOSTS, source.supermarket) ||
      !PAGE_KINDS.has(source.kind) ||
      typeof source.id !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(source.id) ||
      typeof source.url !== 'string') refuse()
  let url
  try { url = new URL(source.url) } catch { refuse() }
  if (url.protocol !== 'https:' || url.hostname !== HOSTS[source.supermarket] ||
      url.port !== '' || url.username || url.password || url.search || url.hash) refuse()
  const paths = source.supermarket === 'plus'
    ? { product: '/product/', catalog: '/producten', offers: '/aanbiedingen' }
    : { product: '/producten/', catalog: '/producten/', offers: '/aanbiedingen' }
  const path = paths[source.kind]
  if (!(url.pathname === path || url.pathname.startsWith(path.endsWith('/') ? path : path + '/')) ||
      (source.kind === 'product' && url.pathname.length <= path.length)) refuse()
  return url.href
}
function validPermission(document, source) {
  // Also runs all the existing M1 proof/rights invariants, even if we only
  // request a single chain in this invocation.
  try {
    evaluateSourcePermissionGate(document)
  } catch { refuse() }
  const found = document.sources.find(item => item.supermarket === source.supermarket)
  if (!found || found.permissionStatus !== 'permitted' ||
      found.productionEnabled !== true || !found.evidence?.some(item =>
        item.kind === 'written_permission' || item.kind === 'official_license')) refuse()
}
function validClock(value) {
  const now = value instanceof Date ? value.getTime() : NaN
  if (!Number.isFinite(now)) refuse()
  return new Date(now).toISOString()
}

export async function captureAuthorizedRetailerPage({
  source, permissionDocument, fetchImpl = globalThis.fetch, clock = new Date(),
} = {}) {
  // All security and license admission happens BEFORE even calling fetch().
  const url = safeSource(source)
  validPermission(permissionDocument, source)
  const capturedAt = validClock(clock)
  if (typeof fetchImpl !== 'function') refuse()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'nl-NL,nl;q=0.9',
        'user-agent': 'SUPA-authorized-capture/1.0 (+https://github.com/Zennay/Supa)',
      },
    })
    if (!response || response.status !== 200 || response.redirected === true ||
        typeof response.headers?.get !== 'function') refuse()
    // No 30x follow, no credential-forwarding, no special handling for 403/429.
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'text/html' && type !== 'application/xhtml+xml') refuse()
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) refuse()
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') refuse()
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) refuse()
      bytes += chunk.byteLength
      if (bytes > MAX_BYTES) {
        controller.abort()
        refuse()
      }
      chunks.push(Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)
    const html = buffer.toString('utf8')
    if (Buffer.compare(Buffer.from(html, 'utf8'), buffer) !== 0) refuse()
    return {
      html,
      metadata: {
        id: source.id, supermarket: source.supermarket, kind: source.kind,
        requestedUrl: url, finalUrl: url, capturedAt,
        bytes, sha256: createHash('sha256').update(buffer).digest('hex'),
        contentType: type, success: true,
      },
    }
  } catch {
    refuse() // don't publish response secrets, credentials, body or redirect.
  } finally {
    clearTimeout(timer)
  }
}
async function rejectSymlinkAncestors(target) {
  let path = resolve(target)
  for (;;) {
    try {
      if ((await lstat(path)).isSymbolicLink()) refuse()
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
    const parent = dirname(path)
    if (parent === path) break
    path = parent
  }
}

/** Creates a brand-new private capture bundle that the existing M1 inspector
 * and selector-discovery CLI can consume. Never mutates an older snapshot. */
export async function saveAuthorizedRetailerCapture({
  source, permissionDocument, destination, fetchImpl, clock,
}) {
  if (typeof destination !== 'string' || !destination.trim()) refuse()
  const path = resolve(destination)
  await rejectSymlinkAncestors(path)
  // Never touch the network if the requested artifact already exists.
  let exists = false
  try { await lstat(path); exists = true }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
  if (exists) refuse()
  // Network admission & bounded capture BEFORE creating the output directory.
  const captured = await captureAuthorizedRetailerPage({
    source, permissionDocument, fetchImpl, clock,
  })
  await mkdir(path, { mode: 0o700 })
  try {
    const storeDirectory = resolve(path, source.supermarket)
    await mkdir(storeDirectory, { mode: 0o700 })
    await writeFile(resolve(storeDirectory, source.id + '.html'), captured.html, {
      flag: 'wx', mode: 0o600,
    })
    const manifest = {
      milestone: 'M1 Data Feasibility', bounded: true,
      startedAt: captured.metadata.capturedAt,
      completedAt: captured.metadata.capturedAt,
      sourceCount: 1, successCount: 1, failureCount: 0,
      results: [captured.metadata],
      productionReady: false, publicSavingsClaimEligible: false,
    }
    await writeFile(resolve(path, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx', mode: 0o600,
    })
    return { manifest, captureSaved: true, productionReady: false }
  } catch {
    await rm(path, { recursive: true, force: true })
    refuse()
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== '--source' || argv[2] !== '--out') refuse()
  const source = SOURCES.find(item => item.id === argv[1])
  if (!source) refuse()
  const permissionDocument = JSON.parse(
    await readFile('evidence/m1/source-permission-gate.v1.json', 'utf8'),
  )
  const outcome = await saveAuthorizedRetailerCapture({
    source, destination: argv[3], permissionDocument,
  })
  console.log(JSON.stringify({
    captureSaved: outcome.captureSaved, sourceId: source.id,
    productionReady: false, publicSavingsClaimEligible: false,
  }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Retailer capture refused. Source rights and network scope must be verified.')
    process.exitCode = 1
  })
}
