import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const DEFAULT_FILE = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
// No human decision or authenticated evidence is stored in this discovery list.
// Request/denial/approval outcomes belong in a separate reviewed evidence record.
const VALID_STATUSES = new Set(['unreviewed'])
const MAX_SOURCES = 100
const DISCOVERY_FIELDS = new Set(['version', 'purpose', 'screenedAt', 'milestone', 'sources'])
const SOURCE_FIELDS = new Set([
  'id', 'name', 'researchUrl', 'permissionStatus', 'sourceMechanism',
  'productionEnabled', 'regionScope', 'assortmentScope', 'termsStatus',
  'robotsStatus', 'dataOwner', 'contactStatus', 'expectedRefresh',
  'riskStatus', 'priority', 'permissionEvidence',
])
const REQUIRED_PURPOSE =
  'M5 exploratory retailer discovery only; not an ingest allowlist or grant of data rights'

function assertExactFields(record, allowed, context) {
  // Reject both unknown authority metadata and missing documented fields.
  // Reflect.ownKeys also rejects hidden/non-enumerable or symbol-based bypasses.
  const prototype = Object.getPrototypeOf(record)
  assert(prototype === Object.prototype || prototype === null,
    `M5 ${context} requires a plain research object`)
  const descriptors = Object.getOwnPropertyDescriptors(record)
  const actualKeys = Reflect.ownKeys(record)
  assert(actualKeys.length === allowed.size &&
    actualKeys.every((key) =>
      typeof key === 'string' && allowed.has(key) &&
      Object.hasOwn(descriptors[key], 'value')),
    `M5 ${context} contains missing, unexpected, or accessor schema fields`)
}

const MARKET_LIST_EVIDENCE = new Set([
  'https://www.wur.nl/nl/onderzoek/producten-diensten/dashboard-supermarkten-duurzaamheid-en-gezondheid',
  'https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten',
  'https://www.consumentenbond.nl/acties-claims/nieuws/2025/laagsteprijsclaims-van-supermarkten-update',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function safeResearchUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.username === '' && url.password === '' &&
      url.port === '' && Boolean(url.hostname) &&
      !url.hash && MARKET_LIST_EVIDENCE.has(url.href)
  } catch {
    return false
  }
}

// Exploratory market research is NEVER production permission. The M1 gate is
// deliberately separate, and no M5 source may be enabled by this document.
export function assessRetailerDiscovery(document) {
  assert(document && typeof document === 'object' && !Array.isArray(document),
    'M5 discovery must be an object')
  assertExactFields(document, DISCOVERY_FIELDS, 'root')
  assert(document.purpose === REQUIRED_PURPOSE,
    'M5 discovery purpose must be research-only; production permission is never implied')
  assert(document.version === 1, 'M5 discovery requires version 1')
  assert(document.milestone === 'M5 Expansion (future; current M3 gate OPEN)',
    'M5 discovery cannot assert a later milestone')
  assert(validIsoDate(document.screenedAt) &&
    document.screenedAt <= new Date().toISOString().slice(0, 10),
    'M5 screening date must be a valid non-future ISO date')
  assert(Array.isArray(document.sources) &&
    document.sources.length > 0 && document.sources.length <= MAX_SOURCES,
    'M5 sources must be a nonempty, bounded array')
  const seen = new Set()
  const sources = document.sources.map((record) => {
    assert(record && typeof record === 'object' && !Array.isArray(record),
      'M5 source must be an object')
    assertExactFields(record, SOURCE_FIELDS, 'retailer record')
    assert(typeof record.id === 'string' &&
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(record.id) &&
      !seen.has(record.id), 'M5 source ID must be unique and canonical')
    seen.add(record.id)
    assert(typeof record.name === 'string' && record.name.trim() === record.name &&
      record.name.length > 0 && record.name.length <= 80 &&
      [...record.name].every((char) => { const point = char.codePointAt(0); return point >= 0x20 && point !== 0x7f && !(point >= 0x202a && point <= 0x202e) && !(point >= 0x2066 && point <= 0x2069) }),
      `Invalid source display name for ${record.id}`)
    assert(safeResearchUrl(record.researchUrl),
      `Missing HTTPS market-list evidence for ${record.id}`)
    assert(VALID_STATUSES.has(record.permissionStatus),
      `Unverified permission status for ${record.id}`)
    assert(record.sourceMechanism === 'unassessed',
      `Source mechanism cannot be assumed for ${record.id}`)
    assert(record.productionEnabled === false,
      `Future discovery cannot enable production for ${record.id}`)
    // Every unknown expansion dimension must be explicit; placeholders are
    // not permission, source availability, freshness or approved access.
    for (const [field, expected] of Object.entries({
      regionScope: 'unassessed',
      assortmentScope: 'unassessed',
      termsStatus: 'unreviewed',
      robotsStatus: 'unreviewed',
      dataOwner: 'unassessed',
      contactStatus: 'unreviewed',
      expectedRefresh: 'unassessed',
      riskStatus: 'unknown',
      priority: 'unprioritized',
      permissionEvidence: null,
    })) {
      assert(Object.hasOwn(record, field) && record[field] === expected,
        `M5 discovery cannot claim reviewed ${field} for ${record.id}`)
    }
    return Object.freeze({
      id: record.id, name: record.name,
      permissionStatus: record.permissionStatus,
      sourceMechanism: 'unassessed',
      regionScope: 'unassessed',
      termsStatus: 'unreviewed',
      robotsStatus: 'unreviewed',
      productionEnabled: false,
      nextAction: 'Review official access path, terms and written/licensed permission',
    })
  })
  return {
    milestone: 'M5 candidate research; not eligible during M3',
    sourceCount: sources.length,
    productionReady: false,
    sources: sources.sort((a, b) => a.id.localeCompare(b.id)),
    blockers: sources.filter((source) => source.permissionStatus !== 'denied').length,
  }
}

export async function main(args = process.argv.slice(2)) {
  const positional = args.filter((arg) => !arg.startsWith('--'))
  assert(positional.length <= 1 &&
    args.every((arg) => !arg.startsWith('--') || arg === '--require-production-ready'),
    'Usage: node scripts/m5-audit-retailer-discovery.mjs [file] [--require-production-ready]')
  const input = positional[0] ?? DEFAULT_FILE
  const report = assessRetailerDiscovery(JSON.parse(await readFile(input, 'utf8')))
  console.log(JSON.stringify(report, null, 2))
  if (args.includes('--require-production-ready')) process.exitCode = 2
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
