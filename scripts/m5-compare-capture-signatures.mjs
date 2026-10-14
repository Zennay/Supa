import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { inspectCaptureDirectory } from './m1-inspect-captures.mjs'

const MAX_SOURCES = 100
const MAX_CAPTURE_MANIFEST_BYTES = 8 * 1024 * 1024
const MAX_CAPTURE_HTML_BYTES = 8 * 1024 * 1024
// Keep the entire offline capture review cohort at the same 8 MiB ceiling as
// a single HTML file. Multiple individually-valid captures may exhaust it.
const MAX_AGGREGATE_HTML_BYTES = 8 * 1024 * 1024
const MAX_JSON_LD_BLOCKS = 128
const MAX_APPLICATION_JSON_SCRIPTS = 128
const MAX_JSON_LD_ENTRIES = 256
const MAX_JSON_LD_TERM_LENGTH = 256
const RELEVANT_KEYS = new Set([
  '@context', '@type', '@graph', 'name', 'sku', 'gtin', 'gtin12',
  'gtin13', 'gtin14', 'offers', 'price', 'lowPrice', 'highPrice',
  'priceCurrency', 'priceSpecification', 'availability', 'weight',
  'value', 'unitCode', 'validFrom', 'priceValidUntil',
])
const KNOWN_TYPES = new Set(['Product', 'Offer', 'AggregateOffer', 'ItemList', 'WebPage'])

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

// Only canonical, bounded M1 origin metadata may be compared. An absent,
// object-valued, control-bearing or non-canonical origin must not silently
// produce an 'unchanged' (P3) source-review result. No source label is echoed.
function requireCanonicalOrigin(source) {
  const canonical = (value) => typeof value === 'string' &&
    value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  if (!canonical(source.supermarket) || !canonical(source.kind)) {
    throw new Error('Invalid inspected source origin')
  }
}

// M1's HTML inspector outputs short arrays of JSON-LD type/key strings.
// A forged or degenerate capture must not be silently normalized to an
// empty/small shape; reject it before potentially expensive map/filter/hash.
function canonicalShapeTerms(values) {
  if (!Array.isArray(values) || values.length > MAX_JSON_LD_ENTRIES) return false
  for (let i = 0; i < values.length; i += 1) {
    if (!Object.hasOwn(values, i) || typeof values[i] !== 'string' ||
        values[i].length > MAX_JSON_LD_TERM_LENGTH) return false
  }
  return true
}

function requireBoundedHtmlShape(html) {
  if (!html || typeof html.hasNextData !== 'boolean' ||
      !Array.isArray(html.jsonLd) ||
      !Array.isArray(html.applicationJsonScripts) ||
      html.jsonLd.length > MAX_JSON_LD_BLOCKS ||
      html.applicationJsonScripts.length > MAX_APPLICATION_JSON_SCRIPTS) {
    throw new Error('Invalid or unbounded inspected HTML shape')
  }
  for (let i = 0; i < html.jsonLd.length; i += 1) {
    if (!Object.hasOwn(html.jsonLd, i)) {
      throw new Error('Invalid or unbounded inspected HTML shape')
    }
    const record = html.jsonLd[i]
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        !canonicalShapeTerms(record.type) ||
        !canonicalShapeTerms(record.keys) ||
        (Object.hasOwn(record, 'parseError') && record.parseError !== true)) {
      throw new Error('Invalid or unbounded inspected HTML shape')
    }
  }
  for (let i = 0; i < html.applicationJsonScripts.length; i += 1) {
    if (!Object.hasOwn(html.applicationJsonScripts, i) ||
        !html.applicationJsonScripts[i] ||
        typeof html.applicationJsonScripts[i] !== 'object' ||
        Array.isArray(html.applicationJsonScripts[i]) ||
        !Object.hasOwn(html.applicationJsonScripts[i], 'id') ||
        !Object.hasOwn(html.applicationJsonScripts[i], 'bytes') ||
        (html.applicationJsonScripts[i].id !== null &&
          typeof html.applicationJsonScripts[i].id !== 'string') ||
        !Number.isSafeInteger(html.applicationJsonScripts[i].bytes) ||
        html.applicationJsonScripts[i].bytes < 0) {
      throw new Error('Invalid or unbounded inspected HTML shape')
    }
  }
}

// This fingerprint deliberately excludes names, prices, URLs, DOM text,
// embedded-state payloads, and unknown keys (which may include private data).
export function captureShape(source) {
  if (!source || typeof source !== 'object' || typeof source.id !== 'string') {
    throw new Error('Invalid inspected source')
  }
  // The M1 inspector always produces an explicit boolean. Do not interpret
  // an untrusted "true"/"false", 0/1 or missing success flag as a verified
  // or unavailable capture in the exported pure comparison API.
  if (typeof source.success !== 'boolean') {
    throw new Error('Invalid inspected capture success')
  }
  if (!source.success) {
    requireCanonicalOrigin(source)
    return {
      id: source.id,
      supermarket: source.supermarket,
      kind: source.kind,
      captureStatus: 'unavailable',
      snapshotSha256: null,
      shapeSha256: null,
      schemaOrgStatus: 'unknown',
    }
  }
  if (source.integrity !== 'verified' || !/^[a-f0-9]{64}$/.test(source.manifestSha256 ?? '')) {
    throw new Error('Snapshot integrity verification required')
  }
  requireCanonicalOrigin(source)
  requireBoundedHtmlShape(source.html)
  const shape = {
    hasNextData: source.html.hasNextData === true,
    applicationJsonScriptCount: source.html.applicationJsonScripts.length,
    jsonLd: source.html.jsonLd.map((record) => ({
      parseError: record.parseError === true,
      types: Array.isArray(record.type)
        ? record.type.filter((value) => KNOWN_TYPES.has(value)).sort()
        : [],
      keys: Array.isArray(record.keys)
        ? record.keys.filter((value) => RELEVANT_KEYS.has(value)).sort()
        : [],
    })),
  }

  return {
    id: source.id,
    supermarket: source.supermarket,
    kind: source.kind,
    captureStatus: 'verified',
    snapshotSha256: source.manifestSha256,
    shapeSha256: digest(shape),
    schemaOrgStatus: source.schemaOrgProduct?.type === 'observation'
      ? 'candidate_observation'
      : 'abstain',
    hasNextData: shape.hasNextData,
    jsonLdCount: shape.jsonLd.length,
    jsonLdParseErrors: shape.jsonLd.filter((part) => part.parseError).length,
  }
}

export function compareInspections(current, baseline = null) {
  if (!current || !Array.isArray(current.sources) ||
      current.sources.length > MAX_SOURCES ||
      current.sourceCount !== current.sources.length) {
    throw new Error('Invalid or unbounded current inspection')
  }
  if (baseline && (!Array.isArray(baseline.sources) ||
      baseline.sources.length > MAX_SOURCES ||
      baseline.sourceCount !== baseline.sources.length)) {
    throw new Error('Invalid or unbounded baseline inspection')
  }
  const map = (sources) => {
    const result = new Map()
    for (const source of sources) {
      const shape = captureShape(source)
      if (result.has(shape.id)) throw new Error('Duplicate capture source ID')
      result.set(shape.id, shape)
    }
    return result
  }
  const now = map(current.sources)
  const before = baseline ? map(baseline.sources) : new Map()
  const ids = [...new Set([...now.keys(), ...before.keys()])].sort()
  const changes = ids.map((id) => {
    const latest = now.get(id)
    const previous = before.get(id)
    let status
    // A failed first/new capture is a P1 failure to investigate, not P2
    // healthy-source onboarding, regardless of whether a baseline exists.
    if (!baseline) status = latest?.captureStatus === 'unavailable'
      ? 'unavailable' : 'baseline_missing'
    else if (!latest) status = 'removed'
    else if (!previous) status = latest.captureStatus === 'unavailable'
      ? 'unavailable' : 'added'
    // A reused source ID can conceal a different supermarket or capture type.
    // Treat provenance re-assignment as high-priority drift even when both HTML
    // and shape fingerprints are identical or one capture is unavailable.
    else if (latest.supermarket !== previous.supermarket || latest.kind !== previous.kind) {
      status = 'origin_changed'
    }
    else if (latest.captureStatus !== 'verified' || previous.captureStatus !== 'verified') {
      status = 'unavailable'
    } else if (latest.shapeSha256 !== previous.shapeSha256 ||
               latest.schemaOrgStatus !== previous.schemaOrgStatus) {
      status = 'shape_changed'
    } else if (latest.snapshotSha256 !== previous.snapshotSha256) {
      status = 'content_changed_shape_stable'
    } else {
      status = 'unchanged'
    }
    return { id, status, current: latest ?? null, baseline: previous ?? null }
  })

  return {
    contractVersion: 1,
    mode: 'offline_capture_signature_review_only',
    productionReady: false,
    m5Eligible: false,
    baselineProvided: Boolean(baseline),
    captureCount: now.size,
    changes,
    driftCount: changes.filter((value) =>
      ['removed', 'added', 'unavailable', 'shape_changed', 'origin_changed'].includes(value.status)).length,
    // Only same approved-origin, human-reviewed snapshots can justify selectors.
    reviewerActionRequired: true,
  }
}

// Offline selector triage may only compare measurements with a real, explicitly
// offset observation time. Date.parse alone normalizes impossible calendar days
// and excessive fractional precision, so validate the components first.
// Timestamps are private control data: never put a source value in an error.
function captureObservationInstant(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error('Invalid capture observation time')
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const millis = Number((match[7] ?? '').padEnd(3, '0') || 0)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) {
    throw new Error('Invalid capture observation time')
  }
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, millis)
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 ||
      local.getUTCDate() !== day) {
    throw new Error('Invalid capture observation time')
  }
  let offset = 0
  if (match[8] !== 'Z') {
    const offsetHours = Number(match[8].slice(1, 3))
    const offsetMinutes = Number(match[8].slice(4, 6))
    if (offsetHours > 14 || offsetMinutes > 59 ||
        (offsetHours === 14 && offsetMinutes !== 0)) {
      throw new Error('Invalid capture observation time')
    }
    offset = (match[8][0] === '+' ? 1 : -1) *
      (offsetHours * 60 + offsetMinutes) * 60_000
  }
  return local.getTime() - offset
}

// Never allocate an entire growing manifest via FileHandle.readFile().
// Read at most 8 MiB + 1 byte from the already validated *same* descriptor,
// allowing an exact-limit file while catching concurrent growth before
// allocating or parsing further. This bounds this preflight's input bytes;
// it does not protect separate M1-inspector rereads of the manifest.
async function readBoundedManifest(handle) {
  const chunks = []
  let total = 0
  while (true) {
    const buffer = Buffer.allocUnsafe(Math.min(
      64 * 1024, MAX_CAPTURE_MANIFEST_BYTES + 1 - total,
    ))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (bytesRead === 0) break
    total += bytesRead
    if (total > MAX_CAPTURE_MANIFEST_BYTES) {
      throw new Error('Invalid or oversized M1 capture manifest')
    }
    chunks.push(buffer.subarray(0, bytesRead))
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

// M1's inspector reads every declared source before compareInspections() sees
// its MAX_SOURCES limit. Gate both manifests first, before any source HTML I/O.
// This is a bounded offline preflight, not an atomic filesystem snapshot.
async function preflightBoundedManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json')
  const fail = () => { throw new Error('Invalid or oversized M1 capture manifest') }
  let parsed
  try {
    // Pin the *opened* manifest inode: a separate lstat(path) then
    // readFile(path) could read a different object after a path swap.
    // O_NOFOLLOW refuses final-component symbolic links on Linux.
    const handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1 ||
          !Number.isSafeInteger(info.size) ||
          info.size > MAX_CAPTURE_MANIFEST_BYTES) fail()
      // The byte ceiling is enforced *during* reads, not only after
      // readFile() could have allocated a concurrently grown manifest.
      const raw = await readBoundedManifest(handle)
      parsed = JSON.parse(raw)
    } finally {
      await handle.close()
    }
  } catch {
    fail()
  }
  if (!parsed || parsed.milestone !== 'M1 Data Feasibility' ||
      parsed.bounded !== true || !Array.isArray(parsed.results) ||
      parsed.results.length > MAX_SOURCES ||
      parsed.sourceCount !== parsed.results.length ||
      parsed.results.some((record) => !record ||
        typeof record !== 'object' ||
        typeof record.success !== 'boolean')) fail()
  // An M1 capture is a set of distinct sources, not a bag of observations.
  // The downstream comparison rejects duplicate IDs only *after* the M1
  // inspector would already have read HTML. Reject ambiguous source identity
  // here, on both manifests, before any successful-source filesystem I/O.
  const seenIds = new Set()
  // A malformed later row must not force the M1 inspector to read HTML
  // from earlier success rows before discovering an invalid source origin.
  // Apply exactly the downstream comparator's canonical origin contract
  // to all raw rows, including unavailable/P1 results.
  const canonicalOrigin = (value) => typeof value === 'string' &&
    value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  for (const record of parsed.results) {
    if (typeof record.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.id) ||
        seenIds.has(record.id) ||
        !canonicalOrigin(record.supermarket) ||
        !canonicalOrigin(record.kind)) fail()
    seenIds.add(record.id)
  }
  return parsed.results
}

// Check *both* structural manifests before timestamp or HTML inspection.
// Existing invalid-cohort refusal must win over missing source file/time.
function observationInstants(results) {
  const times = new Map()
  for (const result of results) {
    if (result.success) times.set(result.id, captureObservationInstant(result.capturedAt))
  }
  return times
}

// A symlinked capture root (including an ancestor alias) must not make us
// read a borrowed manifest before the later HTML provenance preflight.
// Run on *both* roots before opening either manifest. This is a conservative
// local check, not descriptor-bound atomic filesystem ownership.
async function requireRegularCaptureRoot(directory) {
  const root = await lstat(directory)
  if (!root.isDirectory() || root.isSymbolicLink() ||
      await realpath(directory) !== path.resolve(directory)) {
    throw new Error('Invalid offline capture tree origin')
  }
}

// M5 is an offline human-only reviewer. Do not let SHA-correct HTML borrowed
// via filesystem aliases pretend to belong to a nominated capture tree.
async function requireRegularCaptureTree(directory, rows) {
  await requireRegularCaptureRoot(directory)
  let totalHtmlBytes = 0
  for (const row of rows) {
    if (!row.success) continue
    const segment = (value) => typeof value === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    if (!segment(row.supermarket) || !segment(row.id)) {
      throw new Error('Invalid offline capture tree origin')
    }
    const storePath = path.join(directory, row.supermarket)
    const sourcePath = path.join(storePath, row.id + '.html')
    const folder = await lstat(storePath)
    const file = await lstat(sourcePath)
    if (!folder.isDirectory() || folder.isSymbolicLink() ||
        !file.isFile() || file.isSymbolicLink() || file.nlink !== 1) {
      // A regular hard-linked HTML inode can point outside the nominal
      // capture tree while retaining a matching content SHA. Offline M5
      // review requires files independently owned by their capture root.
      throw new Error('Invalid offline capture tree origin')
    }
    // A matching SHA proves bytes *match* their manifest, not that reading
    // arbitrary-size HTML is safe. Reject huge sources before readFile and
    // bound the full capture cohort, not only each individual source.
    if (!Number.isSafeInteger(file.size) || file.size < 0 ||
        file.size > MAX_CAPTURE_HTML_BYTES ||
        totalHtmlBytes + file.size > MAX_AGGREGATE_HTML_BYTES) {
      throw new Error('Offline HTML input exceeds resource budget')
    }
    totalHtmlBytes += file.size
  }
}

// Lexically different paths can resolve to the very same M1 capture tree.
// Compare the underlying directory identity rather than argv strings or
// path.normalize(), including symlink/relative aliases. This conservative
// offline preflight does not claim a race-free filesystem snapshot.
async function requireIndependentCaptureRoots(currentDir, baselineDir) {
  const [current, baseline] = await Promise.all([stat(currentDir), stat(baselineDir)])
  if (!current.isDirectory() || !baseline.isDirectory() ||
      (current.dev === baseline.dev && current.ino === baseline.ino)) {
    throw new Error('Independent historical capture directory required')
  }
}

export async function compareCaptureDirectories(currentDir, baselineDir = null) {
  // Refuse directory aliases before even reading the manifest JSON. Still
  // validate both raw manifests before inspecting any successful HTML.
  await requireRegularCaptureRoot(currentDir)
  if (baselineDir) await requireRegularCaptureRoot(baselineDir)
  const currentRows = await preflightBoundedManifest(currentDir)
  const baselineRows = baselineDir ? await preflightBoundedManifest(baselineDir) : null
  await requireRegularCaptureTree(currentDir, currentRows)
  if (baselineRows) await requireRegularCaptureTree(baselineDir, baselineRows)
  // Keep the existing whole-manifest structural checks first, but do not
  // read HTML or assign P3 to one directory masquerading as its own baseline.
  if (baselineDir) await requireIndependentCaptureRoots(currentDir, baselineDir)
  // Every successful source needs a valid time before *any* HTML is read.
  const currentTimes = observationInstants(currentRows)
  const baselineTimes = baselineRows ? observationInstants(baselineRows) : null
  if (baselineTimes) {
    // Historical means strictly earlier for each shared successful source ID,
    // not just for the first row or based on wall-clock string ordering.
    for (const [id, previousInstant] of baselineTimes) {
      const currentInstant = currentTimes.get(id)
      if (currentInstant !== undefined && previousInstant >= currentInstant) {
        throw new Error('Nonhistorical capture observation')
      }
    }
  }
  const current = await inspectCaptureDirectory(currentDir)
  const baseline = baselineDir ? await inspectCaptureDirectory(baselineDir) : null
  return compareInspections(current, baseline)
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length < 1 || argv.length > 2 || argv.some((arg) => !arg || arg.startsWith('--'))) {
    throw new Error('Usage: node scripts/m5-compare-capture-signatures.mjs <M1-capture-dir> [baseline-M1-capture-dir]')
  }
  const report = await compareCaptureDirectories(argv[0], argv[1] ?? null)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
