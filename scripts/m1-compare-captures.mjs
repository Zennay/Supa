import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stable(nested)]),
  )
}

function structuralView(source) {
  const html = source?.html
  if (!html) return null

  return stable({
    hasNextData: Boolean(html.hasNextData),
    jsonLd: Array.isArray(html.jsonLd)
      ? html.jsonLd.map((entry) => ({
          type: Array.isArray(entry.type) ? [...entry.type].sort() : [],
          keys: Array.isArray(entry.keys) ? [...entry.keys].sort() : [],
          parseError: Boolean(entry.parseError),
        }))
      : [],
    applicationJsonScripts: Array.isArray(html.applicationJsonScripts)
      ? html.applicationJsonScripts.map((entry) => ({ id: entry.id ?? null }))
      : [],
  })
}

function schemaView(source) {
  const result = source?.schemaOrgProduct
  if (!result) return null
  if (result.type === 'observation') {
    const observation = result.observation ?? {}
    return stable({
      type: 'observation',
      hasSourceProductId: Boolean(observation.sourceProductId),
      hasPrice: Number.isInteger(observation.currentPriceCents),
      availability: observation.availability ?? 'unknown',
      packUnit: observation.pack?.unit ?? 'unknown',
    })
  }

  return stable({
    type: 'abstain',
    reasons: Array.isArray(result.reasons) ? [...result.reasons].sort() : [],
  })
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right))
}


function isSafeSourceId(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function indexById(report) {
  if (report.milestone !== 'M1 Data Feasibility') {
    throw new Error(`Unexpected milestone: ${report.milestone}`)
  }
  if (!Array.isArray(report.sources)) {
    throw new Error('Inspection sources must be an array')
  }

  const index = new Map()
  for (const source of report.sources) {
    if (!isSafeSourceId(source?.id) || index.has(source.id)) {
      throw new Error(`Invalid or duplicate source id: ${source?.id}`)
    }
    index.set(source.id, source)
  }
  return index
}

export function compareInspectionReports(baseline, current) {
  const baselineById = indexById(baseline)
  const currentById = indexById(current)
  const ids = [...new Set([...baselineById.keys(), ...currentById.keys()])].sort()
  if (ids.length === 0) {
    throw new Error('Cannot compare empty M1 inspection reports')
  }

  const changes = ids.map((id) => {
    const before = baselineById.get(id)
    const after = currentById.get(id)

    if (!before) {
      return {
        id,
        supermarket: after.supermarket,
        kind: after.kind,
        classification: 'source-added',
        reviewRequired: true,
      }
    }
    if (!after) {
      return {
        id,
        supermarket: before.supermarket,
        kind: before.kind,
        classification: 'source-removed',
        reviewRequired: true,
      }
    }

    const supermarketChanged =
      (before.supermarket ?? null) !== (after.supermarket ?? null)
    const kindChanged = (before.kind ?? null) !== (after.kind ?? null)
    const captureStatusChanged = Boolean(before.success) !== Boolean(after.success)
    const finalUrlChanged = (before.finalUrl ?? null) !== (after.finalUrl ?? null)
    const contentChanged =
      (before.manifestSha256 ?? null) !== (after.manifestSha256 ?? null)
    const structureChanged = !same(structuralView(before), structuralView(after))
    const schemaContractChanged = !same(schemaView(before), schemaView(after))

    const reasons = []
    if (supermarketChanged) reasons.push('supermarket-changed')
    if (kindChanged) reasons.push('source-kind-changed')
    if (captureStatusChanged) reasons.push('capture-status-changed')
    if (finalUrlChanged) reasons.push('final-url-changed')
    if (structureChanged) reasons.push('structured-markup-changed')
    if (schemaContractChanged) reasons.push('schema-product-contract-changed')
    if (contentChanged) reasons.push('content-hash-changed')

    return {
      id,
      supermarket: after.supermarket,
      kind: after.kind,
      classification:
        reasons.length === 0
          ? 'unchanged'
          : reasons.some((reason) => reason !== 'content-hash-changed')
            ? 'review'
            : 'content-only',
      reviewRequired: reasons.some((reason) => reason !== 'content-hash-changed'),
      reasons,
      before: {
        success: Boolean(before.success),
        finalUrl: before.finalUrl ?? null,
        sha256: before.manifestSha256 ?? null,
      },
      after: {
        success: Boolean(after.success),
        finalUrl: after.finalUrl ?? null,
        sha256: after.manifestSha256 ?? null,
      },
    }
  })

  return {
    milestone: 'M1 Data Feasibility',
    comparedAt: new Date().toISOString(),
    baselineCaptureStartedAt: baseline.captureStartedAt ?? null,
    currentCaptureStartedAt: current.captureStartedAt ?? null,
    sourceCount: ids.length,
    unchangedCount: changes.filter((change) => change.classification === 'unchanged').length,
    contentOnlyCount: changes.filter((change) => change.classification === 'content-only').length,
    reviewCount: changes.filter((change) => change.reviewRequired).length,
    reviewRequired: changes.some((change) => change.reviewRequired),
    changes,
  }
}

async function readInspection(inputPath) {
  const statsPath = inputPath.endsWith('.json')
    ? inputPath
    : path.join(inputPath, 'inspection.json')
  return JSON.parse(await readFile(statsPath, 'utf8'))
}

export async function compareCaptureDirectories(baselinePath, currentPath) {
  const baseline = await readInspection(baselinePath)
  const current = await readInspection(currentPath)
  const report = compareInspectionReports(baseline, current)

  const outputDir = currentPath.endsWith('.json')
    ? path.dirname(currentPath)
    : currentPath
  await writeFile(
    path.join(outputDir, 'drift.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  )
  return report
}

export async function main() {
  const baselinePath = process.argv[2]
  const currentPath = process.argv[3]
  if (!baselinePath || !currentPath) {
    throw new Error(
      'Usage: npm run m1:compare-captures -- <baseline-dir-or-inspection.json> <current-dir-or-inspection.json>',
    )
  }

  const report = await compareCaptureDirectories(baselinePath, currentPath)
  console.log(JSON.stringify(report, null, 2))

  if (report.reviewRequired) {
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
