import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { assessRetailerDiscovery } from './m5-audit-retailer-discovery.mjs'

// Manual review prep only. These data are market-list candidates; NO source
// authorization, retailer endpoint discovery or live data access is inferred.
const DEFAULT_FILE = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const OUTPUT_FORMATS = new Set(['csv', 'json', 'markdown'])
const CHECKS = Object.freeze([
  'Confirm chain identity, current banner and Dutch location/region',
  'Find the correct owner-operated API, feed or public source; no invented selector',
  'Read current terms, robots guidance, acceptable use and technical restrictions',
  'Ask data rights holder for written permission or official license as needed',
  'Record allowed product, price, offer, stock, region and freshness scope',
  'Keep retailer disabled; independent M1 permission gate and M3/M4 proof must be respected',
])

function requireValid(condition, message) {
  if (!condition) throw new Error(message)
}

export function buildRetailerReviewPack(document) {
  const audit = assessRetailerDiscovery(document)
  const byId = new Map(document.sources.map((source) => [source.id, source]))
  const items = audit.sources.map((source) => ({
    retailerId: source.id,
    retailerName: source.name,
    marketListReference: byId.get(source.id).researchUrl,
    existingM1ProofPair: source.id === 'plus' || source.id === 'dekamarkt',
    permissionStatus: source.permissionStatus,
    sourceMechanism: source.sourceMechanism,
    regionScope: 'unassessed',
    assortmentScope: 'unassessed',
    termsStatus: source.termsStatus,
    robotsStatus: source.robotsStatus,
    dataOwner: 'unassessed',
    permissionEvidence: null,
    productionEnabled: false,
    nextAction: CHECKS.join('; '),
  }))
  return {
    version: 1,
    purpose: 'Human offline source/rights research only; not an ingest allowlist',
    milestone: 'M3 active / M5 not eligible',
    productionReady: false,
    sourceCount: items.length,
    items,
  }
}

function csvCell(value) {
  // Prevent spreadsheet formula execution, including leading invisible format
  // characters that may precede '='. CSV quoting alone is not sufficient.
  const clean = String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .trim()
  const canonical = clean.normalize('NFKC')
  const safe = /^[=+\-@]/u.test(canonical) ? "'" + clean : clean
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function renderReviewPackCsv(pack) {
  const columns = [
    ['retailerId', 'retailerId'],
    ['retailerName', 'retailerName'],
    ['marketListReference', 'marketListReference'],
    ['existingM1ProofPair', 'existingM1ProofPair'],
    ['permissionStatus', 'permissionStatus'],
    ['sourceMechanism', 'sourceMechanism'],
    ['regionScope', 'regionScope'],
    ['assortmentScope', 'assortmentScope'],
    ['termsStatus', 'termsStatus'],
    ['robotsStatus', 'robotsStatus'],
    ['dataOwner', 'dataOwner'],
    ['permissionEvidence', 'permissionEvidence'],
    ['productionEnabled', 'productionEnabled'],
    ['nextAction', 'nextAction'],
  ]
  const row = (values) => values.map(csvCell).join(',')
  return [row(columns.map(([heading]) => heading)),
    ...pack.items.map((item) => row(columns.map(([, field]) => item[field])))].join('\r\n') + '\r\n'
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .trim()
}

export function renderReviewPackMarkdown(pack) {
  const lines = [
    '# SUPA M5 — pending human retailer source review',
    '',
    '**NOT production-ready. M3 is still open; M4/M5 not authorized.**',
    'Retailer market-list mentions are NOT a license to download data.',
    '',
    '| Supermarket | Market-list evidence | M1 proof pair | Permission | Live ingest |',
    '| --- | --- | --- | --- | --- |',
    ...pack.items.map((item) =>
      '| ' + [escapeMarkdown(item.retailerName),
        escapeMarkdown(item.marketListReference),
        item.existingM1ProofPair ? 'existing M1 research only' : 'no',
        escapeMarkdown(item.permissionStatus), 'disabled'].join(' | ') + ' |'),
    '',
    '## Manual approval checklist',
    ...CHECKS.map((check) => '- [ ] ' + check),
    '',
    'No human review or official permission has been completed by this file.',
    '',
  ]
  return lines.join('\n')
}

export function parseReviewPackArgs(args) {
  let format = 'csv'
  let input = DEFAULT_FILE
  let formatSeen = false
  let fileSeen = false
  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      requireValid(!formatSeen, 'Duplicate --format')
      formatSeen = true
      format = arg.slice('--format='.length)
      requireValid(OUTPUT_FORMATS.has(format), 'Expected --format=csv|json|markdown')
    } else if (arg.startsWith('-')) {
      throw new Error('Unexpected option: ' + arg)
    } else {
      requireValid(!fileSeen, 'Only one optional input file is allowed')
      fileSeen = true
      input = arg
    }
  }
  return { format, input }
}

export async function main(args = process.argv.slice(2)) {
  const { format, input } = parseReviewPackArgs(args)
  const pack = buildRetailerReviewPack(JSON.parse(await readFile(input, 'utf8')))
  const rendered = format === 'csv'
    ? renderReviewPackCsv(pack)
    : format === 'markdown'
      ? renderReviewPackMarkdown(pack)
      : JSON.stringify(pack, null, 2) + '\n'
  process.stdout.write(rendered)
  return pack
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
