import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function byId(items, label) {
  if (!Array.isArray(items)) {
    throw new Error(`${label} must be an array`)
  }
  const map = new Map()
  for (const item of items) {
    if (!isSafeSourceId(item?.id) || map.has(item.id)) {
      throw new Error(`Invalid or duplicate ${label} id: ${item?.id}`)
    }
    map.set(item.id, item)
  }
  return map
}

function isSafeSourceId(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function duplicateIds(ids) {
  const seen = new Set()
  const duplicates = new Set()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    else seen.add(id)
  }
  return [...duplicates].sort()
}

function candidateIndex(index) {
  const candidateItems = Array.isArray(index?.candidates) ? index.candidates : []
  const abstentionItems = Array.isArray(index?.abstentions) ? index.abstentions : []
  const candidateIds = candidateItems
    .map((item) => item?.id)
    .filter((id) => isSafeSourceId(id))
  const abstentionIds = abstentionItems
    .map((item) => item?.id)
    .filter((id) => isSafeSourceId(id))

  return {
    candidates: new Set(candidateIds),
    abstentions: new Set(abstentionIds),
    candidateIds,
    abstentionIds,
    structureValid:
      Array.isArray(index?.candidates) &&
      Array.isArray(index?.abstentions) &&
      candidateIds.length === candidateItems.length &&
      abstentionIds.length === abstentionItems.length,
    milestoneMatches: index?.milestone === 'M1 Data Feasibility',
    countsMatch:
      index?.candidateCount === candidateItems.length &&
      index?.abstentionCount === abstentionItems.length,
    duplicateCandidateIds: duplicateIds(candidateIds),
    duplicateAbstentionIds: duplicateIds(abstentionIds),
  }
}

export function buildEvidenceSummary({
  manifest,
  inspection,
  freshness,
  candidateIndex: candidates,
}) {
  for (const [name, document] of Object.entries({
    manifest,
    inspection,
    freshness,
  })) {
    if (document.milestone !== 'M1 Data Feasibility') {
      throw new Error(`${name} has unexpected milestone: ${document.milestone}`)
    }
  }

  const manifestById = byId(manifest.results, 'manifest results')
  for (const [id, captured] of manifestById) {
    if (typeof captured.success !== 'boolean') {
      throw new Error(`Invalid manifest success flag for ${id}`)
    }
  }
  if (manifest.bounded !== true) {
    throw new Error('Capture manifest must be explicitly bounded')
  }
  if (
    !Number.isSafeInteger(manifest.sourceCount) ||
    manifest.sourceCount !== manifest.results.length
  ) {
    throw new Error('Capture manifest sourceCount does not match results length')
  }
  const actualSuccessCount = manifest.results.filter(
    (result) => result.success === true,
  ).length
  const actualFailureCount = manifest.results.length - actualSuccessCount
  if (
    !Number.isSafeInteger(manifest.successCount) ||
    manifest.successCount !== actualSuccessCount ||
    !Number.isSafeInteger(manifest.failureCount) ||
    manifest.failureCount !== actualFailureCount
  ) {
    throw new Error('Capture manifest success/failure counts do not match results')
  }

  const inspectionById = byId(inspection.sources, 'inspection sources')
  const freshnessById = byId(freshness.sources, 'freshness sources')
  const candidateSets = candidateIndex(candidates)

  const ids = [...manifestById.keys()].sort()
  const missingInspection = ids.filter((id) => !inspectionById.has(id))
  const missingFreshness = ids.filter((id) => !freshnessById.has(id))
  const inspectionIdentityMismatches = ids.filter((id) => {
    const captured = manifestById.get(id)
    const inspected = inspectionById.get(id)
    return (
      inspected &&
      ((captured.supermarket ?? null) !== (inspected.supermarket ?? null) ||
        (captured.kind ?? null) !== (inspected.kind ?? null))
    )
  })
  const freshnessIdentityMismatches = ids.filter((id) => {
    const captured = manifestById.get(id)
    const fresh = freshnessById.get(id)
    return (
      fresh &&
      ((captured.supermarket ?? null) !== (fresh.supermarket ?? null) ||
        (captured.kind ?? null) !== (fresh.kind ?? null))
    )
  })

  const sources = ids.map((id) => {
    const captured = manifestById.get(id)
    const inspected = inspectionById.get(id)
    const fresh = freshnessById.get(id)

    const reasons = []
    if (!captured.success) reasons.push('capture-failed')
    if (!inspected) reasons.push('inspection-missing')
    else if (captured.success && inspected.integrity !== 'verified') {
      reasons.push('integrity-not-verified')
    }
    if (!fresh) reasons.push('freshness-missing')
    else if (fresh.freshness !== 'fresh') reasons.push(`freshness-${fresh.freshness}`)

    const isProduct = captured.kind === 'product'
    const candidate = candidateSets.candidates.has(id)
    const abstention = candidateSets.abstentions.has(id)
    if (isProduct && candidate === abstention) {
      reasons.push(
        candidate
          ? 'product-has-both-candidate-and-abstention'
          : 'product-candidate-decision-missing',
      )
    }

    return {
      id,
      supermarket: captured.supermarket,
      kind: captured.kind,
      captureSuccess: Boolean(captured.success),
      integrity: inspected?.integrity ?? null,
      freshness: fresh?.freshness ?? null,
      productDecision: !isProduct
        ? 'not-applicable'
        : candidate
          ? 'candidate'
          : abstention
            ? 'abstain'
            : 'missing',
      evidenceComplete: reasons.length === 0,
      reasons,
    }
  })

  const supermarkets = [...new Set(sources.map((source) => source.supermarket))].sort()
  const requiredKinds = ['product', 'catalog', 'offers']
  const coverage = supermarkets.map((supermarket) => ({
    supermarket,
    kinds: Object.fromEntries(
      requiredKinds.map((kind) => [
        kind,
        sources.some(
          (source) =>
            source.supermarket === supermarket &&
            source.kind === kind &&
            source.evidenceComplete,
        ),
      ]),
    ),
  }))

  const unexpectedInspection = [...inspectionById.keys()].filter(
    (id) => !manifestById.has(id),
  )
  const unexpectedFreshness = [...freshnessById.keys()].filter(
    (id) => !manifestById.has(id),
  )
  const productManifestIds = new Set(
    ids.filter((id) => manifestById.get(id)?.kind === 'product'),
  )
  const candidateDecisionIds = [
    ...new Set([
      ...candidateSets.candidateIds,
      ...candidateSets.abstentionIds,
    ]),
  ].sort()
  const unexpectedCandidateDecisions = candidateDecisionIds.filter(
    (id) => !productManifestIds.has(id),
  )
  const candidateDecisionConflicts = [...candidateSets.candidates]
    .filter((id) => candidateSets.abstentions.has(id))
    .sort()

  const documentConsistency = {
    missingInspection,
    missingFreshness,
    inspectionIdentityMismatches,
    freshnessIdentityMismatches,
    unexpectedInspection,
    unexpectedFreshness,
    unexpectedCandidateDecisions,
    candidateDecisionConflicts,
    duplicateCandidateIds: candidateSets.duplicateCandidateIds,
    duplicateAbstentionIds: candidateSets.duplicateAbstentionIds,
    candidateIndexStructureValid: candidateSets.structureValid,
    candidateIndexMilestoneMatches: candidateSets.milestoneMatches,
    candidateIndexCountsMatch: candidateSets.countsMatch,
    sourceCountsMatch:
      manifest.results.length === inspection.sources.length &&
      manifest.results.length === freshness.sources.length,
  }
  documentConsistency.consistent =
    documentConsistency.sourceCountsMatch &&
    documentConsistency.candidateIndexStructureValid &&
    documentConsistency.candidateIndexMilestoneMatches &&
    documentConsistency.candidateIndexCountsMatch &&
    Object.values(documentConsistency)
      .filter(Array.isArray)
      .every((values) => values.length === 0)

  const hasEvidenceSources = sources.length > 0
  const captureReady =
    hasEvidenceSources && sources.every((source) => source.evidenceComplete)
  const coverageReady =
    hasEvidenceSources &&
    coverage.every((entry) =>
      requiredKinds.every((kind) => entry.kinds[kind]),
    )

  const productSources = sources.filter((source) => source.kind === 'product')
  const adapterEvidenceReady =
    documentConsistency.consistent &&
    captureReady &&
    coverageReady &&
    productSources.length === supermarkets.length &&
    productSources.every((source) =>
      ['candidate', 'abstain'].includes(source.productDecision),
    )

  return {
    milestone: 'M1 Data Feasibility',
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    supermarketCount: supermarkets.length,
    supermarkets,
    requiredKinds,
    documentConsistency,
    evidenceCompleteCount: sources.filter((source) => source.evidenceComplete)
      .length,
    captureReady,
    coverageReady,
    adapterEvidenceReady,
    nextAction: !documentConsistency.consistent
      ? 'repair-evidence-bundle'
      : !captureReady
        ? 'resolve-capture-integrity-or-freshness'
        : !coverageReady
          ? 'restore-required-source-coverage'
          : 'review-product-candidates-and-build-source-specific-adapters',
    coverage,
    sources,
  }
}

export async function buildEvidenceSummaryFromDirectory(rootDir) {
  const [manifest, inspection, freshness, candidates] = await Promise.all([
    readJson(path.join(rootDir, 'manifest.json')),
    readJson(path.join(rootDir, 'inspection.json')),
    readJson(path.join(rootDir, 'freshness.json')),
    readJson(path.join(rootDir, 'sanitized-candidates', 'index.json')),
  ])

  const report = buildEvidenceSummary({
    manifest,
    inspection,
    freshness,
    candidateIndex: candidates,
  })

  await writeFile(
    path.join(rootDir, 'evidence-summary.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  )
  return report
}

export async function main() {
  const rootDir = process.argv[2] || process.env.SUPA_CAPTURE_DIR
  if (!rootDir) {
    throw new Error(
      'Usage: npm run m1:evidence-summary -- <capture-directory>',
    )
  }

  const report = await buildEvidenceSummaryFromDirectory(rootDir)
  console.log(JSON.stringify(report, null, 2))

  if (!report.adapterEvidenceReady) {
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
