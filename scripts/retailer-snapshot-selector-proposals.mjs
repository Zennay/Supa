import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'
import { decodeExactRetailerHtmlBytes } from './retailer-private-html-byte-identity.mjs'
/**
 * OFFLINE selector discovery from a previously approved and integrity-linked M1
 * capture. A proposal is NEVER an extracted product, verified selector, license
 * or source permission. No HTTP, browser automation or remote DOM access.
 */
import { createHash } from 'node:crypto'
import { lstat, open, mkdir, writeFile } from 'node:fs/promises'
import { constants as fsFlags } from 'node:fs'
import { dirname, resolve, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_HTML_TAGS = 100_000
const MAX_CAPTURE_SOURCES = 32
const HOSTS = { plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' }
const KINDS = new Set(['product', 'catalog', 'offers'])
const ALLOWED_JSONLD_KEYS = new Set([
  '@context', '@type', '@graph', 'sku', 'gtin', 'gtin13', 'mpn',
  'name', 'offers', 'price', 'Price', 'priceCurrency',
  'availability', 'weight', 'value', 'unitCode', 'priceSpecification',
])
const CLASS_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,60}$/
const RELEVANCE_PATTERN = /(?:product|price|pack|aanbied|offer|plp|pdp|item|unit|stock|amount|naam|name|sku|koop|beschik|promo|ingredient|beschrijv)/i

function reject(message) { throw new Error('Offline selector review refused: ' + message) }
function sha256(html) { return createHash('sha256').update(html, 'utf8').digest('hex') }
function owned(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}
function mapCandidateFields(suggestions) {
  // Semantic hints for AI/human review; NOT parsed product values or vetted CSS.
  const patterns = {
    name: /name|naam|title/i,
    price: /price|prijs/i,
    package: /pack|complementary|unit|weight|size|gewicht/i,
    offer: /offer|promo|aanbied|korting/i,
    availability: /stock|availability|beschik/i,
  }
  return Object.fromEntries(Object.entries(patterns).map(([field, expression]) => [
    field,
    suggestions.filter(item => expression.test(item.selector))
      .slice(0, 8).map(item => ({
        selector: item.selector, status: 'UNVERIFIED_FIELD_HINT',
        reviewerMustVerifySemantics: true,
      })),
  ]))
}
function validCapture(source, requireHash = true) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) reject('malformed source')
  const supermarket = owned(source, 'supermarket')
  const kind = owned(source, 'kind')
  const urlValue = owned(source, 'finalUrl') ?? owned(source, 'requestedUrl') ?? owned(source, 'url')
  const capturedAt = owned(source, 'capturedAt')
  const id = owned(source, 'id')
  const expectedSha = owned(source, 'sha256')
  if (!Object.hasOwn(HOSTS, supermarket) || !KINDS.has(kind) ||
      typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(id) ||
      (requireHash ? (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha)) : (expectedSha !== undefined && (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha)))) ||
      typeof capturedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(capturedAt) ||
      (!Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) > Date.now())) reject('invalid capture identity/hash/timestamp')
  let url
  try { url = new URL(urlValue) } catch { reject('invalid source URL') }
  if (url.protocol !== 'https:' || url.hostname !== HOSTS[supermarket] ||
      url.port || url.username || url.password || url.search || url.hash) {
    reject('unapproved source host, URL or credentials')
  }
  return { id, supermarket, kind, url: url.href, capturedAt, sha256: expectedSha ?? null }
}

function jsonLdShape(text, types, keys) {
  let value
  try { value = JSON.parse(text) } catch { return false }
  const visit = (node, depth = 0) => {
    if (depth > 12 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.slice(0, 100).forEach(child => visit(child, depth + 1)); return }
    for (const [key, child] of Object.entries(node).slice(0, 100)) {
      if (ALLOWED_JSONLD_KEYS.has(key)) keys.add(key)
      if (key === '@type') {
        for (const type of (Array.isArray(child) ? child : [child])) {
          if (typeof type === 'string' && /^(?:Product|Offer|AggregateOffer|ItemList|WebPage)$/.test(type)) types.add(type)
        }
      }
      if (child && typeof child === 'object') visit(child, depth + 1)
    }
  }
  visit(value)
  return true
}

function assertClosedInertMarkup(html) {
  // Static tag extraction cannot distinguish script/template/comment text from
  // real DOM if delimiters are truncated. Refuse the entire snapshot instead
  // of treating an unterminated inert fragment as price/stock evidence.
  const commentsRemoved = html.replace(/<!--[\s\S]*?-->/g, ' ')
  if (commentsRemoved.includes('<!--') || commentsRemoved.includes('-->')) {
    reject('unclosed inert HTML comment')
  }
  for (const tag of ['script', 'style', 'template', 'noscript', 'textarea', 'head', 'svg']) {
    const opened = [...commentsRemoved.matchAll(new RegExp('<' + tag + '\\b', 'gi'))].length
    const closed = [...commentsRemoved.matchAll(new RegExp('<\\/' + tag + '\\s*>', 'gi'))].length
    if (opened !== closed) reject('unclosed inert HTML element')
  }
}

export function proposeRetailerSelectors(source, html) {
  const identity = validCapture(source)
  if (typeof html !== 'string' || html.startsWith('\uFEFF') ||
      html.includes('\u0000') ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES ||
      Buffer.from(html, 'utf8').toString('utf8') !== html ||
      sha256(html) !== identity.sha256) reject('HTML must be bounded, UTF-8 and match source SHA-256')
  assertClosedInertMarkup(html)
  const scripts = []
  const jsonLdTypes = new Set()
  const jsonLdKeys = new Set()
  let invalidJsonLdCount = 0
  const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?:template|noscript|textarea)\b[^>]*>[\s\S]*?<\/(?:template|noscript|textarea)\s*>/gi, '')
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_, attrs, script) => {
      const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
      const scriptType = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase()
      if (scriptType === 'application/ld+json') {
        if (!jsonLdShape(script, jsonLdTypes, jsonLdKeys)) invalidJsonLdCount++
      }
      if (/\bid\s*=\s*(?:"__NUXT_DATA__"|'__NUXT_DATA__')/i.test(attrs)) {
        scripts.push('nuxt-data-script')
      }
      return ' '
    })
  const counts = new Map()
  let htmlTagCount = 0
  for (const tag of activeHtml.matchAll(/<([a-z][a-z0-9-]{0,30})\b([^<>]{0,2048})>/gi)) {
    htmlTagCount++
    if (htmlTagCount > MAX_HTML_TAGS) reject('unbounded HTML tag count')
    const tagName = tag[1].toLowerCase()
    // Values become *review-only* CSS proposals, not trusted selectors.
    const classAttr = /\bclass\s*=\s*(?:"([^"]{0,512})"|'([^']{0,512})')/i.exec(tag[2])
    if (!classAttr) continue
    const classes = (classAttr[1] ?? classAttr[2]).trim().split(/\s+/).slice(0, 24)
    for (const name of classes) {
      if (!CLASS_PATTERN.test(name) || !RELEVANCE_PATTERN.test(name)) continue
      const selector = tagName + '.' + name
      counts.set(selector, (counts.get(selector) ?? 0) + 1)
    }
  }
  const suggestions = [...counts.entries()]
    .sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b))
    .slice(0, 40)
    .map(([selector, occurrences]) => ({
      selector, occurrences, status: 'UNVERIFIED_PROPOSAL',
      requiresReviewedSnapshotAndHumanApproval: true,
    }))
  return {
    schemaVersion: 1,
    artifactType: 'supa-offline-selector-proposals',
    source: identity,
    byteLength: Buffer.byteLength(html, 'utf8'),
    inspectedTagCount: htmlTagCount,
    embeddedSignals: {
      nuxtDataScriptPresent: scripts.includes('nuxt-data-script'),
      jsonLdTypes: [...jsonLdTypes].sort(),
      jsonLdKeys: [...jsonLdKeys].sort(),
      invalidJsonLdCount,
    },
    proposedSelectors: suggestions,
    possibleFieldSelectors: mapCandidateFields(suggestions),
    readyForScraping: false, sourcePermissionVerified: false,
    currentPricesExtracted: false, publicationAllowed: false,
  }
}

async function checkNonSymlinkParents(path) {
  let current = resolve(path)
  for (;;) {
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) reject('symlink path components not allowed')
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (current === parent) break
    current = parent
  }
}
// Read exactly one pinned regular inode; never follow an alias after
// checking its name. Old path-based lstat/readFile was open to swap races.
async function readPinnedCaptureFile(path, limit) {
  await checkNonSymlinkParents(path)
  const parent = await lstat(dirname(path))
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size < 1 || before.size > limit) reject('unsafe snapshot inode')
  const handle = await open(path, fsFlags.O_RDONLY | fsFlags.O_NOFOLLOW |
    fsFlags.O_NONBLOCK)
  try {
    const fdBefore = await handle.stat()
    if (!fdBefore.isFile() || fdBefore.nlink !== 1 ||
        fdBefore.size !== before.size || fdBefore.dev !== before.dev ||
        fdBefore.ino !== before.ino) reject('snapshot swapped before open')
    const bytes = await handle.readFile()
    const fdAfter = await handle.stat()
    await checkNonSymlinkParents(path)
    const named = await lstat(path)
    const parentAfter = await lstat(dirname(path))
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 ||
        named.dev !== fdAfter.dev || named.ino !== fdAfter.ino ||
        parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino ||
        before.size !== bytes.length || fdAfter.size !== bytes.length ||
        fdBefore.mtimeMs !== fdAfter.mtimeMs ||
        fdBefore.ctimeMs !== fdAfter.ctimeMs) {
      reject('snapshot identity changed during inspection')
    }
    return bytes
  } finally { await handle.close() }
}

export async function proposeFromM1CaptureDirectory(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') reject('capture path required')
  await checkNonSymlinkParents(dir)
  const manifestPath = join(resolve(dir), 'manifest.json')
  await checkNonSymlinkParents(manifestPath)
  let manifest
  try {
    manifest = parseUniqueKeyRetailerJson(
      new TextDecoder('utf-8', { fatal:true })
        .decode(await readPinnedCaptureFile(manifestPath, 512 * 1024)), 512 * 1024)
  } catch { reject('invalid manifest JSON or file') }
  if (!manifest || !Array.isArray(manifest.results) ||
      manifest.results.length < 1 || manifest.results.length > MAX_CAPTURE_SOURCES ||
      manifest.sourceCount !== manifest.results.length) reject('invalid bounded capture manifest')
  const proposals = []
  const seen = new Set()
  for (const record of manifest.results) {
    if (typeof record.success !== 'boolean') reject('capture success flag missing')
    const source = validCapture(record, record.success === true)
    if (seen.has(source.id)) reject('duplicate source ID')
    seen.add(source.id)
    if (record.success !== true) {
      proposals.push({ sourceId: source.id, status: 'CAPTURE_UNAVAILABLE', reason: 'not a successful authorized capture' })
      continue
    }
    const filename = join(resolve(dir), source.supermarket, source.id + '.html')
    await checkNonSymlinkParents(filename)
    const html = decodeExactRetailerHtmlBytes(
      await readPinnedCaptureFile(filename, MAX_HTML_BYTES), MAX_HTML_BYTES)
    proposals.push(proposeRetailerSelectors(source, html))
  }
  return {
    schemaVersion: 1, captureDirectoryReviewOnly: true,
    analyzedSources: proposals.length, selectorSets: proposals,
    automatedSelectorPromotion: false, productionEnabled: false,
    legalAccessMustBeVerifiedSeparately: true,
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3 || argv[0] !== '--out' ||
      !argv[1] || !argv[2] || argv[1].startsWith('-') || argv[2].startsWith('-')) {
    reject('usage: --out <new-local-proposals.json> <existing-approved-M1-capture-dir>')
  }
  const output = resolve(argv[1])
  const input = resolve(argv[2])
  if (output === input || output.startsWith(input + sep)) reject('output must be outside capture tree')
  await checkNonSymlinkParents(output)
  const report = await proposeFromM1CaptureDirectory(input)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await checkNonSymlinkParents(output)
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ selectorReviewWritten: true, sourceCount: report.analyzedSources, productionEnabled: false }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Offline selector proposal refused. Nothing was promoted or published.')
    process.exitCode = 1
  })
}
