import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MAX_CAPTURE_AGE_HOURS = 24

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function hoursBetween(olderMs, newerMs) {
  return Math.max(0, (newerMs - olderMs) / 3_600_000)
}

export function evaluateManifestFreshness(
  manifest,
  {
    now = new Date(),
    maxCaptureAgeHours = DEFAULT_MAX_CAPTURE_AGE_HOURS,
  } = {},
) {
  if (manifest.milestone !== 'M1 Data Feasibility') {
    throw new Error(`Unexpected milestone: ${manifest.milestone}`)
  }
  if (!Array.isArray(manifest.results)) {
    throw new Error('Capture manifest results must be an array')
  }
  if (!Number.isFinite(maxCaptureAgeHours) || maxCaptureAgeHours <= 0) {
    throw new Error('maxCaptureAgeHours must be a positive number')
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now))
  if (!Number.isFinite(nowMs)) {
    throw new Error('now must be a valid date')
  }

  const sources = manifest.results.map((result) => {
    const capturedAtMs = parseDate(result.capturedAt)
    const captureAgeHours =
      capturedAtMs === null ? null : hoursBetween(capturedAtMs, nowMs)
    const stale =
      captureAgeHours === null || captureAgeHours > maxCaptureAgeHours

    const lastModifiedMs = parseDate(result.lastModified)
    const upstreamLastModifiedAgeHours =
      lastModifiedMs === null ? null : hoursBetween(lastModifiedMs, nowMs)

    const validators = {
      etagPresent: typeof result.etag === 'string' && result.etag.length > 0,
      lastModifiedPresent: lastModifiedMs !== null,
    }

    const reasons = []
    if (!result.success) reasons.push('capture-failed')
    if (capturedAtMs === null) reasons.push('invalid-captured-at')
    else if (captureAgeHours > maxCaptureAgeHours) reasons.push('capture-stale')
    if (!validators.etagPresent && !validators.lastModifiedPresent) {
      reasons.push('no-upstream-cache-validator')
    }

    return {
      id: result.id,
      supermarket: result.supermarket,
      kind: result.kind,
      success: Boolean(result.success),
      status: result.status ?? null,
      capturedAt: result.capturedAt ?? null,
      captureAgeHours:
        captureAgeHours === null ? null : Number(captureAgeHours.toFixed(3)),
      maxCaptureAgeHours,
      freshness:
        !result.success
          ? 'failed'
          : stale
            ? 'stale'
            : 'fresh',
      etag: result.etag ?? null,
      lastModified: result.lastModified ?? null,
      upstreamLastModifiedAgeHours:
        upstreamLastModifiedAgeHours === null
          ? null
          : Number(upstreamLastModifiedAgeHours.toFixed(3)),
      validators,
      sha256: result.sha256 ?? null,
      reasons,
    }
  })

  return {
    milestone: manifest.milestone,
    evaluatedAt: new Date(nowMs).toISOString(),
    policy: {
      maxCaptureAgeHours,
      note:
        'M1 evidence policy for snapshot age; upstream ETag/Last-Modified are recorded as evidence but are not treated as proof of business-data freshness.',
    },
    sourceCount: sources.length,
    freshCount: sources.filter((source) => source.freshness === 'fresh').length,
    staleCount: sources.filter((source) => source.freshness === 'stale').length,
    failedCount: sources.filter((source) => source.freshness === 'failed').length,
    unknownValidatorCount: sources.filter(
      (source) =>
        !source.validators.etagPresent &&
        !source.validators.lastModifiedPresent,
    ).length,
    acceptable: sources.every(
      (source) => source.success && source.freshness === 'fresh',
    ),
    sources,
  }
}

export async function evaluateCaptureDirectory(
  rootDir,
  {
    now = new Date(),
    maxCaptureAgeHours = DEFAULT_MAX_CAPTURE_AGE_HOURS,
  } = {},
) {
  const manifest = JSON.parse(
    await readFile(path.join(rootDir, 'manifest.json'), 'utf8'),
  )
  const report = evaluateManifestFreshness(manifest, {
    now,
    maxCaptureAgeHours,
  })

  await writeFile(
    path.join(rootDir, 'freshness.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  )
  return report
}

function parseMaxAge(argv) {
  const flagIndex = argv.indexOf('--max-age-hours')
  if (flagIndex === -1) return DEFAULT_MAX_CAPTURE_AGE_HOURS
  const raw = Number(argv[flagIndex + 1])
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error('--max-age-hours requires a positive number')
  }
  return raw
}

export async function main() {
  const rootDir = process.argv[2] || process.env.SUPA_CAPTURE_DIR
  if (!rootDir || rootDir.startsWith('--')) {
    throw new Error(
      'Usage: npm run m1:evaluate-freshness -- <capture-directory> [--max-age-hours 24]',
    )
  }

  const report = await evaluateCaptureDirectory(rootDir, {
    maxCaptureAgeHours: parseMaxAge(process.argv.slice(3)),
  })
  console.log(JSON.stringify(report, null, 2))

  if (!report.acceptable) {
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
