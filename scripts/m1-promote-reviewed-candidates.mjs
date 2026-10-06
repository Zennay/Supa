import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { validateRawProductObservation } from '../src/data/ingestion.ts'

const MAX_REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1000

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function validIso(value) {
  if (typeof value !== 'string') return false

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/)
  if (!match || !Number.isFinite(Date.parse(value))) return false

  const [, year, month, day] = match
  const calendarDate = `${year}-${month}-${day}`
  const parsedCalendarDate = new Date(`${calendarDate}T00:00:00.000Z`)
  return (
    !Number.isNaN(parsedCalendarDate.getTime()) &&
    parsedCalendarDate.toISOString().slice(0, 10) === calendarDate
  )
}

function isSafeSourceId(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function requireReviewChronology(candidate, approval, now = Date.now()) {
  const capturedAt = Date.parse(candidate.source.capturedAt)
  const reviewedAt = Date.parse(approval.reviewedAt)

  if (reviewedAt < capturedAt) {
    throw new Error(
      `Candidate ${candidate.source.id} review cannot predate its capture`,
    )
  }

  if (reviewedAt > now + MAX_REVIEW_CLOCK_SKEW_MS) {
    throw new Error(
      `Candidate ${candidate.source.id} review timestamp is implausibly in the future`,
    )
  }
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

  requireReviewChronology(candidate, approval)
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

function validatedCandidateIndex(index) {
  if (!Array.isArray(index.candidates) || !Array.isArray(index.abstentions)) {
    throw new Error('Sanitized candidate index must contain candidates and abstentions arrays')
  }
  if (
    index.candidateCount !== index.candidates.length ||
    index.abstentionCount !== index.abstentions.length
  ) {
    throw new Error('Sanitized candidate index declared counts do not match its arrays')
  }

  const candidateIds = index.candidates.map((entry) => entry?.id)
  const abstentionIds = index.abstentions.map((entry) => entry?.id)
  for (const id of [...candidateIds, ...abstentionIds]) {
    if (!isSafeSourceId(id)) {
      throw new Error('Sanitized candidate index contains an unsafe source id')
    }
  }

  const duplicateIds = (ids) => {
    const seen = new Set()
    return ids.filter((id) => {
      if (seen.has(id)) return true
      seen.add(id)
      return false
    })
  }

  if (duplicateIds(candidateIds).length > 0) {
    throw new Error('Sanitized candidate index contains duplicate candidate ids')
  }
  if (duplicateIds(abstentionIds).length > 0) {
    throw new Error('Sanitized candidate index contains duplicate abstention ids')
  }

  const abstentionSet = new Set(abstentionIds)
  const conflicts = candidateIds.filter((id) => abstentionSet.has(id))
  if (conflicts.length > 0) {
    throw new Error(
      `Sanitized candidate index contains candidate/abstention conflicts: ${conflicts.join(', ')}`,
    )
  }

  for (const entry of index.candidates) {
    const expectedFile = `${entry.id}.json`
    if (entry.file !== expectedFile) {
      throw new Error(
        `Sanitized candidate index has unexpected candidate file for ${entry.id}: ${entry.file}`,
      )
    }
  }

  return {
    candidateEntries: new Map(index.candidates.map((entry) => [entry.id, entry])),
    abstentionIds: new Set(abstentionIds),
  }
}

function requireTrustedCandidate(candidate, entry) {
  if (candidate?.version !== 1) {
    throw new Error(
      `Sanitized candidate must use version 1: ${entry.id}`,
    )
  }
  if (!candidate?.source || typeof candidate.source !== 'object') {
    throw new Error(
      `Sanitized candidate is missing source metadata: ${entry.id}`,
    )
  }
  if (!isSafeSourceId(candidate.source.id)) {
    throw new Error(
      `Sanitized candidate contains an unsafe source id: ${candidate?.source?.id ?? 'unknown'}`,
    )
  }
  if (candidate.source.id !== entry.id) {
    throw new Error(
      `Sanitized candidate source id mismatch: expected=${entry.id} actual=${candidate.source.id}`,
    )
  }
  if (candidate.source.kind !== 'product') {
    throw new Error(
      `Sanitized candidate must come from a product source: ${entry.id}`,
    )
  }

  const observation = validateRawProductObservation(candidate.observation)
  const provenance = observation.provenance
  const checks = [
    ['supermarket', candidate.source.supermarket, provenance.supermarket],
    ['kind', candidate.source.kind, provenance.kind],
    ['url', candidate.source.url, provenance.url],
    ['capturedAt', candidate.source.capturedAt, provenance.capturedAt],
    ['sha256', candidate.source.sha256, provenance.sha256],
  ]

  for (const [key, expected, actual] of checks) {
    if (expected !== actual) {
      throw new Error(
        `Sanitized candidate provenance mismatch for ${entry.id} field ${key}: expected=${expected} actual=${actual}`,
      )
    }
  }

  return candidate
}

async function readCandidateWithIntegrity(captureDir, entry) {
  if (!/^[a-f0-9]{64}$/.test(entry?.candidateSha256 ?? '')) {
    throw new Error(
      `Sanitized candidate index is missing a valid candidate SHA-256 for ${entry?.id ?? 'unknown'}`,
    )
  }

  const filePath = path.join(
    captureDir,
    'sanitized-candidates',
    entry.file,
  )
  const serialized = await readFile(filePath, 'utf8')
  const actualSha256 = sha256Text(serialized)
  if (actualSha256 !== entry.candidateSha256) {
    throw new Error(
      `Sanitized candidate integrity mismatch for ${entry.id}: expected=${entry.candidateSha256} actual=${actualSha256}`,
    )
  }

  const candidate = JSON.parse(serialized)
  return requireTrustedCandidate(candidate, entry)
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

  const { candidateEntries, abstentionIds } = validatedCandidateIndex(index)

  const promoteApprovals = review.approvals.filter(
    (approval) => approval?.decision === 'promote',
  )
  const seenApprovalIds = new Set()
  for (const approval of promoteApprovals) {
    if (seenApprovalIds.has(approval.id)) {
      throw new Error(
        `Review file contains duplicate promotion approval for: ${approval.id}`,
      )
    }
    seenApprovalIds.add(approval.id)
  }

  await mkdir(outputDir, { recursive: true })

  const promoted = []
  for (const approval of promoteApprovals) {
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

    const candidate = await readCandidateWithIntegrity(captureDir, entry)
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
      candidateSha256: entry.candidateSha256,
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
