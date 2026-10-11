import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, mkdtemp, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Independent feasibility probe, not a production price scraper.
export const RESEARCH_SOURCES = Object.freeze([
  { id: 'ah-halfvolle-melk', store: 'ah', kind: 'product', url: 'https://www.ah.nl/producten/product/wi1525/halfvolle-melk' },
  { id: 'dirk-boodschappen', store: 'dirk', kind: 'catalog', url: 'https://www.dirk.nl/boodschappen' },
  { id: 'dirk-halvarine', store: 'dirk', kind: 'product', url: 'https://www.dirk.nl/boodschappen/zuivel-kaas/boter-margarine/1%20de%20beste%20halvarine/113861' },
  { id: 'hoogvliet-magere-melk', store: 'hoogvliet', kind: 'product', url: 'https://www.hoogvliet.com/product/melkan-magere-melk' },
  { id: 'jumbo-halfvolle-melk', store: 'jumbo', kind: 'product', url: 'https://www.jumbo.com/producten/jumbo-halfvolle-melk-500ml-753539PAK' },
])
const HOSTS = Object.freeze({ ah: 'www.ah.nl', dirk: 'www.dirk.nl', hoogvliet: 'www.hoogvliet.com', jumbo: 'www.jumbo.com' })
const MAX_BYTES = 5 * 1024 * 1024
const MAX_HEADER_BYTES = 64 * 1024
const TIMEOUT_SECONDS = 20

export function validateResearchSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('invalid source')
  if (!/^[a-z][a-z0-9-]{1,65}$/.test(source.id) || !Object.hasOwn(HOSTS, source.store)) throw new Error('unregistered source')
  if (!['product', 'catalog', 'offers'].includes(source.kind)) throw new Error('unsupported kind')
  let url
  try { url = new URL(source.url) } catch { throw new Error('invalid source URL') }
  if (url.protocol !== 'https:' || url.hostname !== HOSTS[source.store] || url.port || url.username || url.password || url.hash) {
    throw new Error('source URL is not on its exact HTTPS supermarket host')
  }
  return true
}

export function researchTransport(env = process.env) {
  const enabled = env.SUPA_RESEARCH_APPROVED === '1'
  const rawProxy = env.SUPA_RESEARCH_PROXY_URL
  if (rawProxy && !enabled) throw new Error('proxy configuration requires explicit approved research opt-in')
  let proxy = null
  if (rawProxy) {
    let url
    try { url = new URL(rawProxy) } catch { throw new Error('invalid research proxy URL') }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.hash || url.search || url.pathname !== '/') {
      throw new Error('proxy must be a simple credential-free http(s) endpoint')
    }
    proxy = url.href
  }
  return { approved: enabled, proxy }
}

export function parseCaptureHeaders(raw) {
  // Body max-filesize does not cap curl's separate --dump-header output.
  // Reject unbounded header bytes before any parsing/allocation.
  if (typeof raw !== 'string' || raw.length > MAX_HEADER_BYTES ||
      Buffer.byteLength(raw, 'utf8') > MAX_HEADER_BYTES) {
    throw new Error('response headers exceed byte budget')
  }
  const blocks = raw.replace(/\r\n/g, '\n').trim().split(/\n\n+/)
  const last = blocks.at(-1) || ''
  const lines = last.split('\n')
  const response = /^HTTP\/(?:1\.[01]|2|3)\s+(\d{3})\b/.exec(lines.shift() || '')
  if (!response) throw new Error('unrecognized HTTP response headers')
  const headers = new Map()
  for (const line of lines) {
    // Obsolete folded headers or malformed orphan lines can hide extra
    // transfer codings; never archive ambiguous raw bytes as HTML.
    if (/^[ \t]/.test(line)) throw new Error('ambiguous response header continuation')
    const colon = line.indexOf(':')
    if (colon < 1) throw new Error('malformed response header line')
    const k = line.slice(0, colon).trim().toLowerCase()
    // Content-Type is singular. A first-wins map could label conflicting HTTP
    // intermediary headers as HTML and wrongly archive an ambiguous response.
    if (k === 'content-type' && headers.has(k)) throw new Error('ambiguous response content-type')
    // curl stores raw response bytes; without --compressed, encoded bytes
    // cannot safely be labeled or reviewed as an HTML snapshot.
    if (k === 'content-encoding' && headers.has(k)) throw new Error('ambiguous response content-encoding')
    if (!headers.has(k)) headers.set(k, line.slice(colon + 1).trim())
  }
  if (headers.has('content-encoding') &&
      headers.get('content-encoding').toLowerCase() !== 'identity') {
    throw new Error('unsupported response content-encoding')
  }
  return { status: Number(response[1]), contentType: (headers.get('content-type') || '').split(';')[0].trim().toLowerCase() }
}

function runCurl(args, env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn('curl', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let status = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', piece => { if (status.length < 100) status += piece.slice(0, 100 - status.length) })
    child.stderr.resume()
    child.on('error', reject)
    child.on('close', code => resolveResult({ code, status }))
  })
}

function refuseUnsafePrivateOutput() {
  throw new Error('private research output path rejected')
}

// Inspect lexical ancestors rather than resolving symlinks with realpath.
// Existing private root and per-source output directories must be owner-only;
// normal /tmp or home ancestors need only be actual directories (no aliases).
async function validatePrivateOutputAncestry(outputDir, sourceDir) {
  const privateRoots = new Set([resolve(outputDir), resolve(sourceDir)])
  let current = resolve(sourceDir)
  while (true) {
    let details
    try {
      details = await lstat(current)
    } catch (error) {
      if (error?.code !== 'ENOENT') refuseUnsafePrivateOutput()
    }
    if (details && (!details.isDirectory() || details.isSymbolicLink() ||
        (privateRoots.has(current) && (details.mode & 0o077) !== 0))) {
      refuseUnsafePrivateOutput()
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

export async function captureResearchSource(id, { env = process.env, outputDir = join('artifacts', 'm1-multistore-research') } = {}) {
  const source = RESEARCH_SOURCES.find(entry => entry.id === id)
  if (!source) throw new Error('unknown research source (run --list)')
  validateResearchSource(source)
  const transport = researchTransport(env)
  if (!transport.approved) throw new Error('review retailer terms/robots and explicitly set SUPA_RESEARCH_APPROVED=1 before capture')
  const working = await mkdtemp(join(tmpdir(), 'supa-m1-research-'))
  try {
    const headerPath = join(working, 'headers')
    const bodyPath = join(working, 'body.html')
    const args = ['--disable', '--silent', '--show-error', '--http1.1',
      '--proto', '=https', '--max-time', String(TIMEOUT_SECONDS),
      '--connect-timeout', '10', '--max-filesize', String(MAX_BYTES),
      '--dump-header', headerPath, '--output', bodyPath, '--write-out', '%{http_code}']
    // Explicit no-proxy routing unless an authorized fixed proxy is configured.
    if (!transport.proxy) args.push('--noproxy', '*')
    args.push(source.url)
    const restrictedEnv = { PATH: env.PATH || '/usr/bin:/bin', HOME: working }
    if (transport.proxy) restrictedEnv.HTTPS_PROXY = transport.proxy
    const response = await runCurl(args, restrictedEnv)
    if (response.code !== 0) throw new Error('capture failed safely (curl code ' + response.code + '; no retry/proxy fallback)')
    const headerDetails = await stat(headerPath)
    if (!headerDetails.isFile() || headerDetails.size > MAX_HEADER_BYTES) {
      throw new Error('response headers exceed byte budget')
    }
    const headers = parseCaptureHeaders(await readFile(headerPath, 'utf8'))
    // The final curl HTTP code must agree with the last dumped response block.
    // Disagreement is not a trusted raw HTML snapshot, even if headers say 200.
    if (headers.status !== 200) throw new Error('source returned HTTP ' + headers.status + '; capture stopped without retry')
    if (!/^\d{3}$/.test(response.status) || Number(response.status) !== headers.status) {
      throw new Error('curl final HTTP status disagrees with response headers')
    }
    if (!['text/html', 'application/xhtml+xml'].includes(headers.contentType)) throw new Error('source did not return HTML')
    const bodyStats = await stat(bodyPath)
    if (bodyStats.size === 0 || bodyStats.size > MAX_BYTES) throw new Error('source body is empty or exceeds byte cap')
    const body = await readFile(bodyPath)
    const sha256 = createHash('sha256').update(body).digest('hex')
    const dir = resolve(outputDir, id)
    await validatePrivateOutputAncestry(outputDir, dir)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await validatePrivateOutputAncestry(outputDir, dir)
    const basename = 'capture-' + Date.now() + '-' + process.pid
    const html = join(dir, basename + '.html')
    const meta = join(dir, basename + '.json')
    const metadata = JSON.stringify({ version: 1, type: 'research-only-not-price-proof', sourceId: id,
      store: source.store, url: source.url, observedAt: new Date().toISOString(),
      mediaType: headers.contentType, httpStatus: 200, bytes: bodyStats.size, sha256,
      proxyMode: transport.proxy ? 'approved-fixed-egress' : 'direct' }, null, 2) + '\n'
    // Reserve both unique private paths with exclusive handles. If either write
    // fails, remove only the files opened by this invocation; never touch a
    // pre-existing colliding capture or leave an unpaired private snapshot.
    let htmlHandle
    let metaHandle
    try {
      htmlHandle = await open(html, 'wx', 0o600)
      metaHandle = await open(meta, 'wx', 0o600)
      await htmlHandle.writeFile(body)
      await metaHandle.writeFile(metadata)
      await Promise.all([htmlHandle.close(), metaHandle.close()])
    } catch (error) {
      await Promise.allSettled([htmlHandle, metaHandle]
        .filter(Boolean).map(handle => handle.close()))
      if (htmlHandle) await rm(html, { force: true })
      if (metaHandle) await rm(meta, { force: true })
      throw error
    }
    return { status: 'saved', sourceId: id, html, meta, bytes: bodyStats.size, sha256 }
  } finally {
    await rm(working, { recursive: true, force: true })
  }
}

export async function main(args = process.argv.slice(2), env = process.env, log = console.log) {
  if (args.length === 1 && args[0] === '--list') {
    log(JSON.stringify(RESEARCH_SOURCES.map(({ id, store, kind, url }) => ({ id, store, kind, url })), null, 2))
    return 0
  }
  if (args.length !== 2 || args[0] !== '--capture') throw new Error('usage: --list | --capture <registered-source-id>')
  const result = await captureResearchSource(args[1], { env })
  log(JSON.stringify(result))
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main() }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'research capture failed')
    process.exitCode = 1
  }
}
