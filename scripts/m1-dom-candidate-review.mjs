import { constants } from 'node:fs'
import { lstat, mkdir, open, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RESEARCH_SOURCES } from './m1-multistore-research.mjs'
import { auditCaptureFiles } from './m1-research-snapshot-audit.mjs'

// Human-observed browser DOM candidates only. No network calls, no raw page
// parsing, no price extraction, no promotion to a production retailer adapter.
const STEM = /^capture-[0-9]{13}-[0-9]+$/
const MAX_PROBE_BYTES = 64 * 1024
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_ELEMENTS = 500
const STATIC_SELECTORS = new Map([
  ['h1', 'product-name'],
  ['[itemprop="name"]', 'product-name'],
  ['a[href*="/product"]', 'product'],
  ['[itemtype*="schema.org/Product"]', 'product'],
  ['[itemprop="price"]', 'price'],
  ['[data-testid*="price" i]', 'price'],
  ['[class*="price" i]', 'price'],
  ['[class*="quantity" i]', 'pack'],
  ['[class*="weight" i]', 'pack'],
  ['[class*="offer" i]', 'offers'],
  ['[class*="promotion" i]', 'offers'],
])
const CLASS_SELECTOR = /^[a-z][a-z0-9-]{0,25}\.[a-z_][a-z0-9_-]{1,45}$/i

function ownRecord(value, allowedKeys, requiredKeys) {
  try {
    // Array.isArray itself throws for revoked Proxies: keep all reflections inside guard.
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return null
    const fields = Reflect.ownKeys(value)
    if (fields.length > allowedKeys.length || fields.some(key => typeof key !== 'string' || !allowedKeys.includes(key))) return null
    const plain = Object.create(null)
    for (const key of requiredKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
      plain[key] = descriptor.value
    }
    return plain
  } catch { return null }
}

// A direct API caller can supply an Array subclass, accessor indices, a custom
// Symbol.iterator or an exotic Proxy, even though on-disk JSON cannot. Copy
// exactly the canonical own dense data slots, without invoking index getters
// or iteration hooks. Reflection faults fail closed and reveal no probe data.
function ownDenseArray(value, maxLength) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null
    const length = Object.getOwnPropertyDescriptor(value, 'length')
    if (!length || !Object.hasOwn(length, 'value') ||
        !Number.isSafeInteger(length.value) || length.value > maxLength) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length !== length.value + 1 ||
        keys.some(key => key !== 'length' &&
          (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) ||
           Number(key) >= length.value))) return null
    const items = []
    for (let i = 0; i < length.value; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
      items.push(descriptor.value)
    }
    return items
  } catch { return null }
}

function canonicalUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ELEMENTS
}

function malformed() {
  throw new Error('private DOM candidate report rejected')
}

/**
 * Sanitise an existing Firefox DOM probe export. Selector strings have to
 * match the fixed, reviewed probe vocabulary; unknown keys are rejected, not
 * copied. No live page text, URLs, identities or prices ever reach the output.
 */
export function reviewDomProbe(report, { sourceId, nowMs = Date.now() } = {}) {
  const source = RESEARCH_SOURCES.find(item => item.id === sourceId)
  if (!source || !Number.isFinite(nowMs) || nowMs < 0) malformed()
  const root = ownRecord(report,
    ['version', 'kind', 'originHost', 'capturedAt', 'selectors', 'actualClassCandidates', 'note'],
    ['version', 'kind', 'originHost', 'capturedAt', 'selectors', 'actualClassCandidates'])
  if (!root || root.version !== 1 || root.kind !== 'rendered-dom-candidate-only') malformed()
  if (root.originHost !== new URL(source.url).hostname) malformed()
  const time = canonicalUtc(root.capturedAt)
  if (time === null || time > nowMs || nowMs - time > MAX_AGE_MS) malformed()
  const selectorRows = ownDenseArray(root.selectors, STATIC_SELECTORS.size)
  const classRows = ownDenseArray(root.actualClassCandidates, 25)
  if (!selectorRows || !classRows) malformed()

  const seen = new Set()
  const selectors = []
  for (const raw of selectorRows) {
    const item = ownRecord(raw, ['role', 'selector', 'count', 'groundedInCurrentDom', 'semanticVerified'],
      ['role', 'selector', 'count', 'groundedInCurrentDom', 'semanticVerified'])
    if (!item || STATIC_SELECTORS.get(item.selector) !== item.role ||
        !count(item.count) || item.groundedInCurrentDom !== true || item.semanticVerified !== false ||
        seen.has(item.selector)) malformed()
    seen.add(item.selector)
    selectors.push({ role: item.role, selector: item.selector, count: item.count,
      semanticVerified: false })
  }

  const classSeen = new Set()
  const actualClassCandidates = []
  for (const raw of classRows) {
    const item = ownRecord(raw, ['selector', 'observedNodes', 'semanticVerified'],
      ['selector', 'observedNodes', 'semanticVerified'])
    if (!item || typeof item.selector !== 'string' || !CLASS_SELECTOR.test(item.selector) ||
        !count(item.observedNodes) || item.semanticVerified !== false ||
        classSeen.has(item.selector)) malformed()
    classSeen.add(item.selector)
    actualClassCandidates.push({ selector: item.selector,
      observedNodes: item.observedNodes, semanticVerified: false })
  }

  return {
    version: 1, kind: 'private-dom-candidate-review', sourceId: source.id,
    store: source.store, observedAt: root.capturedAt,
    status: 'human-semantic-review-required',
    selectors, actualClassCandidates,
    domCaptureIdentityVerified: false, retailerPermissionVerified: false,
    semanticVerified: false, livePriceVerified: false,
    publicSavingsClaimEligible: false,
  }
}

async function privateJsonFile(path) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROBE_BYTES) malformed()
    return JSON.parse((await handle.readFile()).toString('utf8'))
  } catch { malformed() }
  finally { await handle?.close() }
}

async function rejectSymlinkedAncestors(path) {
  // mkdir(recursive) and O_NOFOLLOW on the final report are not sufficient:
  // a symlink at an *earlier* path segment can redirect private output.
  // Walk lexical ancestors rather than following realpath aliases.
  let current = resolve(path)
  while (true) {
    let details
    try {
      details = await lstat(current)
    } catch (error) {
      if (error?.code !== 'ENOENT') malformed()
    }
    if (details && (!details.isDirectory() || details.isSymbolicLink())) malformed()
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function ensurePrivateDirectory(path) {
  // Reject redirection before recursive mkdir can create folders elsewhere.
  // Check again after creation to catch an alias substituted during setup.
  await rejectSymlinkedAncestors(path)
  await mkdir(path, { recursive: true, mode: 0o700 })
  await rejectSymlinkedAncestors(path)
  const details = await lstat(path)
  // Never create a private selector report inside an already group/world-readable
  // directory; changing its mode behind an operator's back is not safe either.
  if (!details.isDirectory() || details.isSymbolicLink() || (details.mode & 0o077) !== 0) malformed()
}

/**
 * Verify saved private HTML against its checksum and provenance before
 * associating a *separately observed* rendered DOM probe. Neither proves that
 * browser DOM contents exactly match the private HTTP response.
 */
export async function saveDomCandidateReview({
  sourceId, stem, probePath,
  captureDir = join('artifacts', 'm1-multistore-research'),
  outputDir = join('artifacts', 'm1-dom-reviews'),
  nowMs = Date.now(),
} = {}) {
  if (typeof stem !== 'string' || !STEM.test(stem) ||
      typeof probePath !== 'string' || !probePath) malformed()
  let audit
  try { audit = await auditCaptureFiles({ sourceId, stem, outputDir: captureDir, nowMs }) }
  catch { malformed() }
  if (audit.status !== 'manual-review') malformed()
  const reviewed = reviewDomProbe(await privateJsonFile(probePath), { sourceId, nowMs })
  await ensurePrivateDirectory(outputDir)
  const sourceOutputDir = join(outputDir, sourceId)
  await ensurePrivateDirectory(sourceOutputDir)
  const outputPath = join(sourceOutputDir, stem + '-candidate-review.json')
  const artifact = { ...reviewed, captureStem: stem, captureAuditStatus: audit.status }
  // Never overwrite a previous private research decision or follow a file symlink.
  await writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return {
    status: reviewed.status, sourceId,
    structuralCandidates: reviewed.selectors.length,
    classCandidates: reviewed.actualClassCandidates.length,
    semanticVerified: false, livePriceVerified: false,
    publicSavingsClaimEligible: false,
  }
}

export async function main(args = process.argv.slice(2), log = console.log) {
  if (args.length !== 4 || args[0] !== '--review') {
    throw new Error('usage: --review <registered-source-id> <capture-stem> <private-probe-json>')
  }
  const output = await saveDomCandidateReview({
    sourceId: args[1], stem: args[2], probePath: args[3],
  })
  log(JSON.stringify(output))
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main() }
  catch {
    console.error('private DOM candidate review rejected')
    process.exitCode = 1
  }
}
