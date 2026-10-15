import { lstat, open, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, parse, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { assessRetailerDiscovery } from './m5-audit-retailer-discovery.mjs'

// A research note is *not* permission to ingest. This reader neither contacts
// retailer hosts nor persists reviewer data, and its report omits supplied URLs.
const DISCOVERY = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const KINDS = new Set(['unassessed', 'official-api', 'official-feed', 'public-html', 'no-public-source'])
const RIGHTS = new Set(['unknown', 'request-pending', 'denied', 'claimed-written-permission'])
const REGIONS = new Set(['unknown', 'store-specific', 'regional', 'national'])
const ASSORTMENT = new Set(['unknown', 'products', 'offers', 'products-and-offers'])
const TERMS = new Set(['unreviewed', 'restrictive', 'unclear', 'allowance-claimed'])
const ROBOTS = new Set(['unreviewed', 'restrictive', 'conditional', 'allowance-claimed'])
const CONTACT = new Set(['unassessed', 'owner-identified', 'contact-pending', 'reply-recorded'])
const FRESHNESS = new Set(['unassessed', 'manual-only', 'daily-claimed', 'weekly-claimed'])
const PRIORITY = new Set(['unprioritized', 'P1', 'P2', 'P3'])
const KEYS = new Set(['retailerId', 'reviewedAt', 'sourceKind', 'sourceUrl',
  'termsUrl', 'robotsUrl', 'rightsState', 'rightsEvidenceUrl',
  'regionScope', 'assortmentScope', 'termsReview', 'robotsReview',
  'ownerContactStatus', 'freshnessPlan', 'priority'])
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
const LEDGER_KEYS = new Set(['version', 'purpose', 'reviews'])

function requireResearchShape(value, expected, label) {
  const prototype = Object.getPrototypeOf(value)
  check(prototype === Object.prototype || prototype === null,
    'Invalid private research ' + label + ' object')
  const ownKeys = Reflect.ownKeys(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  check(ownKeys.length === expected.size &&
    ownKeys.every((key) => typeof key === 'string' && expected.has(key) &&
      Object.hasOwn(descriptors[key], 'value')),
    'Invalid private research ' + label + ' schema')
}


function check(ok, message) {
  if (!ok) throw new Error(message)
}

function validDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false
  const parsed = new Date(s + 'T00:00:00.000Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s &&
    s <= new Date().toISOString().slice(0, 10)
}

function validHttps(s) {
  if (typeof s !== 'string' || s.length > 2048) return false
  try {
    const url = new URL(s)
    return url.protocol === 'https:' && url.username === '' && url.password === '' &&
      url.port === '' && url.hostname.includes('.') &&
      url.hostname !== 'localhost' && !url.hash &&
      url.toString() === s
  } catch {
    return false
  }
}

function validOptionalUrl(s) {
  return s === null || validHttps(s)
}

export function assessRetailerResearch(discovery, ledger) {
  const candidates = assessRetailerDiscovery(discovery)
  check(ledger && typeof ledger === 'object' && !Array.isArray(ledger),
    'Invalid research ledger')
  requireResearchShape(ledger, LEDGER_KEYS, 'root')
  check(ledger.version === 1 && ledger.purpose === 'manual-research-only',
    'Invalid research ledger version/purpose')
  check(Array.isArray(ledger.reviews) && ledger.reviews.length <= candidates.sourceCount,
    'Invalid research ledger length')
  const known = new Set(candidates.sources.map((source) => source.id))
  const reviews = new Map()
  for (const review of ledger.reviews) {
    check(review && typeof review === 'object' && !Array.isArray(review), 'Invalid review record')
    requireResearchShape(review, KEYS, 'retailer')
    check(typeof review.retailerId === 'string' && known.has(review.retailerId) &&
      !reviews.has(review.retailerId), 'Unknown or repeated retailer review')
    check(validDate(review.reviewedAt), 'Invalid review date')
    check(KINDS.has(review.sourceKind) && RIGHTS.has(review.rightsState) &&
      REGIONS.has(review.regionScope) && ASSORTMENT.has(review.assortmentScope) &&
      TERMS.has(review.termsReview) && ROBOTS.has(review.robotsReview) &&
      CONTACT.has(review.ownerContactStatus) && FRESHNESS.has(review.freshnessPlan) &&
      PRIORITY.has(review.priority),
    'Invalid research claim')
    check(validOptionalUrl(review.sourceUrl) && validOptionalUrl(review.termsUrl) &&
      validOptionalUrl(review.robotsUrl) && validOptionalUrl(review.rightsEvidenceUrl),
    'Invalid HTTPS evidence location')
    check(['official-api','official-feed','public-html'].includes(review.sourceKind)
      ? review.sourceUrl !== null : review.sourceUrl === null,
    'Source type requires consistent source URL')
    check(review.rightsState === 'claimed-written-permission'
      ? review.rightsEvidenceUrl !== null : review.rightsEvidenceUrl === null,
    'Rights claim requires consistent evidence flag')
    reviews.set(review.retailerId, review)
  }
  const retailers = candidates.sources.map((source) => {
    const review = reviews.get(source.id)
    return {
      id: source.id,
      researchReviewed: Boolean(review),
      sourceKind: review?.sourceKind ?? 'unassessed',
      rightsState: review?.rightsState ?? 'unknown',
      // Never publish reviewer-supplied URL, notes, contact, participant, or evidence
      // details through CI/public artifacts. Mere existence does not prove rights.
      sourceEvidenceProvided: Boolean(review?.sourceUrl),
      termsEvidenceProvided: Boolean(review?.termsUrl),
      robotsEvidenceProvided: Boolean(review?.robotsUrl),
      claimedRightsEvidenceProvided: Boolean(review?.rightsEvidenceUrl),
      regionScope: review?.regionScope ?? 'unknown',
      assortmentScope: review?.assortmentScope ?? 'unknown',
      termsReview: review?.termsReview ?? 'unreviewed',
      robotsReview: review?.robotsReview ?? 'unreviewed',
      ownerContactStatus: review?.ownerContactStatus ?? 'unassessed',
      freshnessPlan: review?.freshnessPlan ?? 'unassessed',
      priority: review?.priority ?? 'unprioritized',
      productionEnabled: false,
      rightsVerified: false,
      nextAction: !review
        ? 'Manual research not submitted'
        : 'Independent rights/legal review and M3/M4 gates required before any ingest',
    }
  })
  return {
    version: 1,
    purpose: 'local human-research completeness only; NOT a permission decision',
    reviewedCount: reviews.size,
    missingCount: retailers.length - reviews.size,
    productionReady: false,
    m5Eligible: false,
    retailers,
  }
}

export function parseResearchArgs(args) {
  check(Array.isArray(args) && args.length === 1 && typeof args[0] === 'string' &&
    args[0].length > 0 && !args[0].startsWith('-'),
  'Usage: node scripts/m5-assess-retailer-research.mjs <local-review-ledger.json>')
  return args[0]
}

// Linux: walk the absolute directory chain under *already opened directory
// descriptors*. O_NOFOLLOW applies to each segment, not just the final file.
// Via /proc/self/fd/<parent> we anchor every next lookup to the trusted inode,
// even when another process renames a directory between lookups. This requires
// the ordinary Linux procfs fd view (VPS and hosted CI are both Linux).
async function openNoSymlinkResearchFile(filename) {
  const canonical = resolve(filename)
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  if (process.platform === 'linux') {
    check(typeof constants.O_NOFOLLOW === 'number' &&
      typeof constants.O_DIRECTORY === 'number',
    'No-follow directory handling is unavailable')
    const directoryFlags = flags | constants.O_DIRECTORY
    let parent = await open(parse(canonical).root, directoryFlags)
    try {
      const components = canonical.slice(parse(canonical).root.length).split(sep)
      check(components.length > 0 && components.every(Boolean),
        'Private reviewer path must name a regular file')
      for (const name of components.slice(0, -1)) {
        const child = await open('/proc/self/fd/' + parent.fd + '/' + name,
          directoryFlags)
        await parent.close()
        parent = child
      }
      return await open('/proc/self/fd/' + parent.fd + '/' + components.at(-1),
        flags)
    } finally {
      await parent.close()
    }
  }

  // Portable fallback: verify that no directory is a symlink before opening
  // the final inode with O_NOFOLLOW. Linux's descriptor-based traversal above
  // is stronger against directory-swap races; no such guarantee is implied here.
  let ancestor = dirname(canonical)
  const folders = []
  while (ancestor !== dirname(ancestor)) {
    folders.push(ancestor)
    ancestor = dirname(ancestor)
  }
  folders.push(ancestor)
  for (const folder of folders.reverse()) {
    const stat = await lstat(folder)
    check(stat.isDirectory() && !stat.isSymbolicLink(),
      'Private reviewer directory must not be symlinked')
  }
  return open(canonical, flags)
}

// Same verified descriptor for file-mode/size checks AND the single read.
export async function loadPrivateRetailerResearch(input) {
  const filename = input instanceof URL ? fileURLToPath(input) : input
  const handle = await openNoSymlinkResearchFile(filename)
  try {
    const fileStats = await handle.stat()
    check(fileStats.isFile() && fileStats.size > 0 && fileStats.size <= 65536,
      'Private reviewer input must be a bounded regular file')
    const publicEmptyTemplate = fileURLToPath(
      new URL('../docs/m5-retailer-research-template.v1.json', import.meta.url))
    if (resolve(filename) !== publicEmptyTemplate && process.platform !== 'win32') {
      check((fileStats.mode & 0o077) === 0,
        'Private reviewer files must not be readable by group or other users')
    }
    // Bound the actual read as well as the initial fstat size: another process
    // may append to the same inode after the stat. Never allocate above 64KiB.
    const maxBytes = 65536
    const chunks = []
    let received = 0
    for (;;) {
      const length = Math.min(8192, maxBytes + 1 - received)
      const chunk = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(chunk, 0, length, null)
      if (bytesRead === 0) break
      received += bytesRead
      check(received <= maxBytes, 'Private reviewer file exceeds 64 KiB')
      chunks.push(chunk.subarray(0, bytesRead))
    }
    check(received > 0, 'Private reviewer file is empty')
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks, received))
    return JSON.parse(utf8)
  } finally {
    await handle.close()
  }
}

export async function main(args = process.argv.slice(2)) {
  const input = parseResearchArgs(args)
  const [discovery, ledger] = await Promise.all([
    readFile(DISCOVERY, 'utf8'), loadPrivateRetailerResearch(input),
  ])
  const report = assessRetailerResearch(JSON.parse(discovery), ledger)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => {
    // Never disclose an input path, URL or private record value in shared logs.
    process.stderr.write('Offline M5 research assessment rejected the supplied file.' + String.fromCharCode(10))
    process.exitCode = 2
  })
}
