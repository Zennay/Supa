import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function requireExactApproval(candidate, approval) {
  const checks = [
    ['id', candidate.source.id],
    ['supermarket', candidate.source.supermarket],
    ['url', candidate.source.url],
    ['capturedAt', candidate.source.capturedAt],
    ['sha256', candidate.source.sha256],
  ]

  for (const [key, expected] of checks) {
    if (approval[key] !== expected) {
      throw new Error(
        `Review mismatch for ${candidate.source.id} field ${key}: expected=${expected} actual=${approval[key]}`,
      )
    }
  }

  if (approval.decision !== 'promote') {
    throw new Error(
      `Candidate ${candidate.source.id} is not explicitly approved for promotion`,
    )
  }
  if (typeof approval.reviewer !== 'string' || !approval.reviewer.trim()) {
    throw new Error(
      `Candidate ${candidate.source.id} approval must identify a reviewer`,
    )
  }
  if (!validIso(approval.reviewedAt)) {
    throw new Error(
      `Candidate ${candidate.source.id} approval must include valid reviewedAt`,
    )
  }
}

function fixtureFromCandidate(candidate, approval) {
  return {
    version: 1,
    fixtureType: 'reviewed-live-product-observation',
    source: candidate.source,
    observation: candidate.observation,
    review: {
      reviewer: approval.reviewer,
      reviewedAt: approval.reviewedAt,
      notes: approval.notes ?? null,
    },
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeFixtureSafely(filePath, fixture) {
  let existing = null
  try {
    existing = await readJson(filePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (existing) {
    const sameSource =
      existing?.source?.sha256 === fixture.source.sha256 &&
      existing?.source?.capturedAt === fixture.source.capturedAt &&
      existing?.source?.url === fixture.source.url

    if (!sameSource) {
      throw new Error(
        `Refusing to overwrite reviewed fixture with different provenance: ${filePath}`,
      )
    }
  }

  await writeFile(filePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8')
}

export async function promoteReviewedCandidates(
  captureDir,
  reviewFile,
  outputDir = path.join('fixtures', 'm1', 'source-candidates'),
) {
  const [index, review] = await Promise.all([
    readJson(path.join(captureDir, 'sanitized-candidates', 'index.json')),
    readJson(reviewFile),
  ])

  if (index.milestone !== 'M1 Data Feasibility') {
    throw new Error(`Unexpected milestone: ${index.milestone}`)
  }
  if (review.version !== 1 || !Array.isArray(review.approvals)) {
    throw new Error('Review file must be version 1 with an approvals array')
  }

  const candidateEntries = new Map(
    (index.candidates ?? []).map((entry) => [entry.id, entry]),
  )
  const abstentionIds = new Set(
    (index.abstentions ?? []).map((entry) => entry.id),
  )

  await mkdir(outputDir, { recursive: true })

  const promoted = []
  for (const approval of review.approvals) {
    if (approval.decision !== 'promote') continue

    if (abstentionIds.has(approval.id)) {
      throw new Error(
        `Cannot promote abstained product source: ${approval.id}`,
      )
    }

    const entry = candidateEntries.get(approval.id)
    if (!entry) {
      throw new Error(
        `Approved source is not present in sanitized candidates: ${approval.id}`,
      )
    }

    const candidate = await readJson(
      path.join(captureDir, 'sanitized-candidates', entry.file),
    )
    requireExactApproval(candidate, approval)

    const fixture = fixtureFromCandidate(candidate, approval)
    const file = `${candidate.source.id}.json`
    await writeFixtureSafely(path.join(outputDir, file), fixture)

    promoted.push({
      id: candidate.source.id,
      supermarket: candidate.source.supermarket,
      file,
      sha256: candidate.source.sha256,
      capturedAt: candidate.source.capturedAt,
    })
  }

  const manifest = {
    version: 1,
    milestone: 'M1 Data Feasibility',
    promotedAt: new Date().toISOString(),
    captureStartedAt: index.captureStartedAt ?? null,
    promotedCount: promoted.length,
    promoted,
  }

  await writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )

  return manifest
}

export async function main() {
  const captureDir = process.argv[2]
  const reviewFile = process.argv[3]
  const outputDir = process.argv[4]

  if (!captureDir || !reviewFile) {
    throw new Error(
      'Usage: npm run m1:promote-reviewed -- <capture-dir> <review.json> [output-dir]',
    )
  }

  const result = await promoteReviewedCandidates(
    captureDir,
    reviewFile,
    outputDir || undefined,
  )
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
