import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { assessRetailerDiscovery } from './m5-audit-retailer-discovery.mjs'

// A research note is *not* permission to ingest. This reader neither contacts
// retailer hosts nor persists reviewer data, and its report omits supplied URLs.
const DISCOVERY = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const KINDS = new Set(['unassessed', 'official-api', 'official-feed', 'public-html', 'no-public-source'])
const RIGHTS = new Set(['unknown', 'request-pending', 'denied', 'claimed-written-permission'])
const REGIONS = new Set(['unknown', 'store-specific', 'regional', 'national'])
const ASSORTMENT = new Set(['unknown', 'products', 'offers', 'products-and-offers'])
const KEYS = new Set(['retailerId', 'reviewedAt', 'sourceKind', 'sourceUrl',
  'termsUrl', 'robotsUrl', 'rightsState', 'rightsEvidenceUrl',
  'regionScope', 'assortmentScope'])
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

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
  check(ledger.version === 1 && ledger.purpose === 'manual-research-only',
    'Invalid research ledger version/purpose')
  check(Array.isArray(ledger.reviews) && ledger.reviews.length <= candidates.sourceCount,
    'Invalid research ledger length')
  check(Object.keys(ledger).every((key) => ['version', 'purpose', 'reviews'].includes(key)),
    'Unknown ledger fields')
  const known = new Set(candidates.sources.map((source) => source.id))
  const reviews = new Map()
  for (const review of ledger.reviews) {
    check(review && typeof review === 'object' && !Array.isArray(review), 'Invalid review record')
    check(Object.keys(review).length === KEYS.size &&
      Object.keys(review).every((key) => KEYS.has(key)),
    'Unexpected, missing or private review field')
    check(typeof review.retailerId === 'string' && known.has(review.retailerId) &&
      !reviews.has(review.retailerId), 'Unknown or repeated retailer review')
    check(validDate(review.reviewedAt), 'Invalid review date')
    check(KINDS.has(review.sourceKind) && RIGHTS.has(review.rightsState) &&
      REGIONS.has(review.regionScope) && ASSORTMENT.has(review.assortmentScope),
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

export async function main(args = process.argv.slice(2)) {
  const input = parseResearchArgs(args)
  const [discovery, ledger] = await Promise.all([
    readFile(DISCOVERY, 'utf8'), readFile(input, 'utf8'),
  ])
  const report = assessRetailerResearch(JSON.parse(discovery), JSON.parse(ledger))
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => {
    // Never disclose an input path, URL or private record value in shared logs.
    process.stderr.write('Offline M5 research assessment rejected the supplied file.\\n')
    process.exitCode = 2
  })
}
