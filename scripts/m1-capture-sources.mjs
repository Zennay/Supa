import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

export const SOURCES = [
  {
    id: 'ah-product-halfvolle-melk',
    supermarket: 'ah',
    kind: 'product',
    url: 'https://www.ah.nl/producten/product/wi1525/halfvolle-melk',
  },
  {
    id: 'ah-catalog',
    supermarket: 'ah',
    kind: 'catalog',
    url: 'https://www.ah.nl/producten',
  },
  {
    id: 'ah-offers',
    supermarket: 'ah',
    kind: 'offers',
    url: 'https://www.ah.nl/bonus',
  },
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
]

const ALLOWED_HOSTS = new Set(['www.ah.nl', 'www.plus.nl'])
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 20_000

export function validateSources(sources = SOURCES) {
  const ids = new Set()
  for (const source of sources) {
    if (!source.id || ids.has(source.id)) {
      throw new Error(`Invalid or duplicate source id: ${source.id}`)
    }
    ids.add(source.id)

    const url = new URL(source.url)
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
      throw new Error(`Source outside allowlist: ${source.url}`)
    }
    if (!['product', 'catalog', 'offers'].includes(source.kind)) {
      throw new Error(`Unsupported source kind: ${source.kind}`)
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

async function captureSource(source, rootDir) {
  const capturedAt = new Date().toISOString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

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
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'nl-NL,nl;q=0.9,en;q=0.5',
        'user-agent': metadata.userAgent,
      },
    })

    const finalUrl = new URL(response.url)
    if (finalUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(finalUrl.hostname)) {
      throw new Error(`Redirected outside allowlist: ${response.url}`)
    }

    const body = await response.text()
    const bytes = Buffer.byteLength(body, 'utf8')
    Object.assign(metadata, {
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

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
