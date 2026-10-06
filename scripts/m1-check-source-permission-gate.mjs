import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const EXPECTED_SOURCES = ['dekamarkt', 'plus']
const PERMISSION_STATUSES = new Set([
  'permitted',
  'permission_required',
  'unresolved',
  'prohibited',
])
const AUTHORIZATION_EVIDENCE = new Set([
  'written_permission',
  'official_license',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function evaluateSourcePermissionGate(document) {
  assert(document?.version === 1, 'source permission gate must use version 1')
  assert(
    document?.milestone === 'M1 Data Feasibility',
    'source permission gate must target M1 Data Feasibility',
  )
  assert(
    validIsoDate(document?.reviewedAt),
    'source permission gate requires a valid ISO review date',
  )
  assert(Array.isArray(document?.sources), 'source permission gate sources must be an array')

  const seen = new Set()
  for (const source of document.sources) {
    assert(
      EXPECTED_SOURCES.includes(source?.supermarket),
      `unexpected source in permission gate: ${source?.supermarket}`,
    )
    assert(
      !seen.has(source.supermarket),
      `duplicate source in permission gate: ${source.supermarket}`,
    )
    seen.add(source.supermarket)

    assert(
      source.technicalStatus === 'proven',
      `${source.supermarket} must have proven technical M1 evidence before permission review`,
    )
    assert(
      PERMISSION_STATUSES.has(source.permissionStatus),
      `invalid permission status for ${source.supermarket}: ${source.permissionStatus}`,
    )
    assert(
      typeof source.productionEnabled === 'boolean',
      `${source.supermarket} productionEnabled must be boolean`,
    )
    assert(
      Array.isArray(source.evidence) && source.evidence.length > 0,
      `${source.supermarket} requires permission evidence`,
    )
    for (const item of source.evidence) {
      assert(
        typeof item?.kind === 'string' && item.kind.length > 0,
        `${source.supermarket} evidence requires a kind`,
      )
      assert(
        safeHttpsUrl(item?.url),
        `${source.supermarket} evidence requires an HTTPS source URL`,
      )
      assert(
        typeof item?.finding === 'string' && item.finding.trim().length > 0,
        `${source.supermarket} evidence requires a finding`,
      )
    }

    const authorizationEvidence = source.evidence.some((item) =>
      AUTHORIZATION_EVIDENCE.has(item.kind),
    )

    if (source.permissionStatus === 'permitted') {
      assert(
        authorizationEvidence,
        `${source.supermarket} cannot be marked permitted without explicit authorization evidence`,
      )
    } else {
      assert(
        source.productionEnabled === false,
        `${source.supermarket} production ingestion must stay disabled while permission is ${source.permissionStatus}`,
      )
    }

    if (source.productionEnabled) {
      assert(
        source.permissionStatus === 'permitted' && authorizationEvidence,
        `${source.supermarket} production ingestion requires permitted status plus authorization evidence`,
      )
    }
  }

  const actual = [...seen].sort()
  assert(
    JSON.stringify(actual) === JSON.stringify(EXPECTED_SOURCES),
    `permission gate must cover exactly: ${EXPECTED_SOURCES.join(', ')}`,
  )

  const blockers = document.sources
    .filter(
      (source) =>
        source.permissionStatus !== 'permitted' || !source.productionEnabled,
    )
    .map((source) => ({
      supermarket: source.supermarket,
      permissionStatus: source.permissionStatus,
      productionEnabled: source.productionEnabled,
      nextAction: source.nextAction ?? null,
    }))

  return {
    milestone: document.milestone,
    reviewedAt: document.reviewedAt,
    expectedSources: EXPECTED_SOURCES,
    productionReady: blockers.length === 0,
    blockers,
  }
}

export async function main() {
  const file =
    process.env.SUPA_SOURCE_PERMISSION_GATE ||
    'evidence/m1/source-permission-gate.v1.json'
  const document = JSON.parse(await readFile(file, 'utf8'))
  const result = evaluateSourcePermissionGate(document)
  console.log(JSON.stringify(result, null, 2))

  if (process.argv.includes('--require-production-ready') && !result.productionReady) {
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
