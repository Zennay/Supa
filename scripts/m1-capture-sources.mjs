import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'
import { isAllowedM1RetailerSourcePath } from './retailer-source-route-safety.mjs'
import { scanOfflineRetailerMarkup } from './retailer-offline-structural-scan.mjs'

export const SOURCES = [
  {
    id: 'plus-product-halfvolle-melk',
    supermarket: 'plus',
    kind: 'product',
    url: 'https://www.plus.nl/product/zuivelmeester-halfvolle-melk-pak-1000-ml-579010',
  },
  {
    id: 'plus-catalog',
    supermarket: 'plus',
    kind: 'catalog',
    url: 'https://www.plus.nl/producten',
  },
  {
    id: 'plus-offers',
    supermarket: 'plus',
    kind: 'offers',
    url: 'https://www.plus.nl/aanbiedingen',
  },
  {
    id: 'dekamarkt-product-halfvolle-melk',
    supermarket: 'dekamarkt',
    kind: 'product',
    url: 'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk/zuivelmeester-halfvolle-melk-1-liter/115873',
  },
  {
    id: 'dekamarkt-category-melk',
    supermarket: 'dekamarkt',
    kind: 'catalog',
    url: 'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk',
  },
  {
    id: 'dekamarkt-offers',
    supermarket: 'dekamarkt',
    kind: 'offers',
    url: 'https://www.dekamarkt.nl/aanbiedingen',
  },
]

const HOST_BY_SUPERMARKET = new Map([
  ['plus', 'www.plus.nl'],
  ['dekamarkt', 'www.dekamarkt.nl'],
])
const SUPPORTED_KINDS = new Set(['product', 'catalog', 'offers'])
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 20_000

function isSafeSourceId(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function expectedHost(supermarket) {
  const host = HOST_BY_SUPERMARKET.get(supermarket)
  if (!host) {
    throw new Error(`Unsupported supermarket: ${supermarket}`)
  }
  return host
}

export function validateSources(sources = SOURCES) {
  const ids = new Set()
  for (const source of sources) {
    if (!isSafeSourceId(source.id) || ids.has(source.id)) {
      throw new Error(`Invalid or duplicate source id: ${source.id}`)
    }
    ids.add(source.id)

    const host = expectedHost(source.supermarket)
    if (!SUPPORTED_KINDS.has(source.kind)) {
      throw new Error(`Unsupported source kind: ${source.kind}`)
    }
    const url = new URL(source.url)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== host ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' || url.hash !== '' ||
      url.href !== source.url ||
      !isAllowedM1RetailerSourcePath(source.supermarket, source.kind, url.pathname)
    ) {
      throw new Error(
        `Source does not match supermarket allowlist (${source.supermarket} -> https://${host}): ${source.url}`,
      )
    }
  }
  return true
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function safeTimestamp(iso) {
  return iso.replace(/[:.]/g, '-')
}

function isHtmlContentType(value) {
  if (!value) return false
  const mediaType = value.split(';', 1)[0].trim().toLowerCase()
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
}

// A capture is a retained source artifact, not just a transient response.
// Refuse wrong encodings, archive opt-outs and redirects before writing bytes.
// This helper has NO I/O and can be exercised with synthetic source HTML.
export function assertArchivableRetailerHtml(body, contentType) {
  if (!isHtmlContentType(contentType) || typeof body !== 'string' ||
      !body || body.startsWith('\uFEFF') || body.includes('\u0000') ||
      Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
    throw new Error('Unacceptable retailer HTML source bytes')
  }
  const parameters = contentType.split(';').slice(1).map(p=>p.trim()).filter(Boolean)
  if (!parameters.every(p=>/^charset\s*=\s*["']?utf-?8["']?$/i.test(p)) ||
      parameters.length > 1) throw new Error('Ambiguous retailer HTML charset')
  const scanned = scanOfflineRetailerMarkup(body)
  if (scanned.hasMetaRefresh || scanned.hasMetaNoStore ||
      scanned.hasMetaNoArchive || scanned.hasConflictingCharset)
    throw new Error('Retailer HTML disallows reliable snapshot archival')
  return Buffer.byteLength(body, 'utf8')
}

async function captureSource(source, rootDir) {
  const capturedAt = new Date().toISOString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const host = expectedHost(source.supermarket)

  const metadata = {
    id: source.id,
    supermarket: source.supermarket,
    kind: source.kind,
    requestedUrl: source.url,
    capturedAt,
    userAgent: 'SUPA-M1-feasibility/0.1 (+https://github.com/Zennay/Supa)',
  }

  try {
    const response = await fetch(source.url, {
      // Never follow an unapproved hostname or path before URL verification.
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'nl-NL,nl;q=0.9,en;q=0.5',
        'user-agent': metadata.userAgent,
      },
    })

    const finalUrl = new URL(response.url)
    if (
      finalUrl.protocol !== 'https:' ||
      finalUrl.hostname !== host ||
      finalUrl.port !== '' ||
      finalUrl.username !== '' ||
      finalUrl.password !== ''
    ) {
      throw new Error(
        `Redirected outside supermarket allowlist (${source.supermarket} -> https://${host}): ${response.url}`,
      )
    }

    const contentType = response.headers.get('content-type')
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
      Object.assign(metadata, {
        finalUrl: response.url,
        status: response.status,
        ok: response.ok,
        contentType,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentLength,
      })
      throw new Error(`Declared response size exceeded ${MAX_BYTES} bytes: ${contentLength}`)
    }

    // Refuse error/anti-bot/JSON responses BEFORE retaining raw HTML bytes.
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (!isHtmlContentType(contentType))
      throw new Error(`Unexpected content type: ${contentType || 'missing'}`)

    const raw = new Uint8Array(await response.arrayBuffer())
    if (raw.byteLength > MAX_BYTES) throw new Error('Retailer HTML response exceeded cap')
    if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
      throw new Error('Retailer HTML BOM not allowed')
    const body = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    const bytes = assertArchivableRetailerHtml(body, contentType)
    Object.assign(metadata, {
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      contentType,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      bytes,
      sha256: sha256(body),
    })

    if (bytes > MAX_BYTES) {
      throw new Error(`Response exceeded ${MAX_BYTES} bytes: ${bytes}`)
    }

    const dir = path.join(rootDir, source.supermarket)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${source.id}.html`), body, 'utf8')

    return { ...metadata, success: true }
  } catch (error) {
    return {
      ...metadata,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function main() {
  validateSources()
  // CI, workflow_dispatch and manual invocations share the SAME fail-closed
  // source permission register. A public HTTPS catalog is never a license.
  // Validate BEFORE creating artifacts, opening a browser or invoking fetch.
  const gateFile = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
  const gateDocument = JSON.parse(await readFile(gateFile, 'utf8'))
  const sourceRights = evaluateSourcePermissionGate(gateDocument)
  if (!sourceRights.productionReady || sourceRights.blockers.length !== 0) {
    throw new Error('M1 external capture denied: canonical retailer source rights not verified')
  }
  const startedAt = new Date().toISOString()
  const rootDir = process.env.SUPA_CAPTURE_DIR ||
    path.join('artifacts', 'm1-captures', safeTimestamp(startedAt))

  await mkdir(rootDir, { recursive: true })
  const results = []

  for (const source of SOURCES) {
    const result = await captureSource(source, rootDir)
    results.push(result)
    console.log(JSON.stringify(result))
  }

  const manifest = {
    milestone: 'M1 Data Feasibility',
    startedAt,
    completedAt: new Date().toISOString(),
    bounded: true,
    sourceCount: SOURCES.length,
    successCount: results.filter((result) => result.success).length,
    failureCount: results.filter((result) => !result.success).length,
    results,
  }

  await writeFile(
    path.join(rootDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )

  if (manifest.failureCount > 0) {
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
