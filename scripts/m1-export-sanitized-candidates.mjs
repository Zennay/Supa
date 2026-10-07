import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isSafeSourceId(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

const EXPECTED_SUPERMARKETS = new Set(['dekamarkt', 'plus'])

function requireSafeUniqueProductSources(sources) {
  const seen = new Set()

  for (const source of sources) {
    if (source?.kind !== 'product') continue

    if (!isSafeSourceId(source.id)) {
      throw new Error(
        `Inspection contains an unsafe product source id: ${source?.id ?? 'unknown'}`,
      )
    }
    if (seen.has(source.id)) {
      throw new Error(
        `Inspection contains a duplicate product source id: ${source.id}`,
      )
    }
    if (!EXPECTED_SUPERMARKETS.has(source.supermarket)) {
      throw new Error(
        `Inspection contains an out-of-scope product supermarket: ${source.supermarket}`,
      )
    }
    if (typeof source.success !== 'boolean') {
      throw new Error(
        `Inspection contains an invalid product success flag for ${source.id}`,
      )
    }
    seen.add(source.id)
  }
}

function requireMatchingProvenance(source, observation) {
  const provenance = observation?.provenance
  if (!provenance || typeof provenance !== 'object') {
    throw new Error(`Missing observation provenance for ${source.id}`)
  }

  const expectedUrl = source.finalUrl ?? source.requestedUrl
  const checks = [
    ['supermarket', source.supermarket],
    ['kind', source.kind],
    ['url', expectedUrl],
    ['capturedAt', source.capturedAt],
    ['sha256', source.manifestSha256],
  ]

  for (const [key, expected] of checks) {
    if (provenance[key] !== expected) {
      throw new Error(
        `Provenance mismatch for ${source.id} field ${key}: expected=${expected} actual=${provenance[key]}`,
      )
    }
  }
}

export async function exportSanitizedCandidates(rootDir) {
  const inspectionPath = path.join(rootDir, 'inspection.json')
  const report = JSON.parse(await readFile(inspectionPath, 'utf8'))

  if (report.milestone !== 'M1 Data Feasibility') {
    throw new Error(`Unexpected milestone: ${report.milestone}`)
  }
  if (!Array.isArray(report.sources)) {
    throw new Error('Inspection sources must be an array')
  }

  requireSafeUniqueProductSources(report.sources)

  const outputDir = path.join(rootDir, 'sanitized-candidates')
  await mkdir(outputDir, { recursive: true })

  const candidates = []
  const abstentions = []

  for (const source of report.sources) {
    if (source.kind !== 'product') continue

    const schemaResult = source.schemaOrgProduct
    if (
      source.success === true &&
      source.integrity === 'verified' &&
      schemaResult?.type === 'observation'
    ) {
      requireMatchingProvenance(source, schemaResult.observation)

      const candidate = {
        version: 1,
        source: {
          id: source.id,
          supermarket: source.supermarket,
          kind: source.kind,
          url: source.finalUrl ?? source.requestedUrl,
          capturedAt: source.capturedAt,
          sha256: source.manifestSha256,
        },
        observation: schemaResult.observation,
      }

      const file = `${source.id}.json`
      const serialized = JSON.stringify(candidate, null, 2) + '\n'
      const candidateSha256 = sha256Text(serialized)
      await writeFile(path.join(outputDir, file), serialized, 'utf8')
      candidates.push({ id: source.id, file, candidateSha256 })
      continue
    }

    abstentions.push({
      id: source.id,
      supermarket: source.supermarket,
      success: source.success,
      integrity: source.integrity ?? null,
      reasons:
        schemaResult?.type === 'abstain'
          ? schemaResult.reasons ?? []
          : [source.error ?? 'no trustworthy Schema.org Product observation'],
    })
  }

  const index = {
    milestone: report.milestone,
    captureStartedAt: report.captureStartedAt ?? null,
    captureCompletedAt: report.captureCompletedAt ?? null,
    candidateCount: candidates.length,
    abstentionCount: abstentions.length,
    candidates,
    abstentions,
  }

  await writeFile(
    path.join(outputDir, 'index.json'),
    JSON.stringify(index, null, 2) + '\n',
    'utf8',
  )

  return index
}

export async function main() {
  const rootDir = process.argv[2] || process.env.SUPA_CAPTURE_DIR
  if (!rootDir) {
    throw new Error(
      'Capture directory required as argv[2] or SUPA_CAPTURE_DIR',
    )
  }

  const index = await exportSanitizedCandidates(rootDir)
  console.log(JSON.stringify(index, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
