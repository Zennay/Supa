import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}


function isSafePathSegment(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function extractJsonLdValues(html) {
  const values = []
  const pattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

  for (const match of html.matchAll(pattern)) {
    const raw = match[1].trim()
    if (!raw) continue
    try {
      values.push(JSON.parse(raw))
    } catch {
      values.push({ __supaParseError: true })
    }
  }
  return values
}

export function inspectHtml(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null

  const jsonLd = []
  for (const parsed of extractJsonLdValues(html)) {
    if (parsed?.__supaParseError) {
      jsonLd.push({ type: [], keys: [], parseError: true })
      continue
    }

    const values = Array.isArray(parsed) ? parsed : [parsed]
    for (const value of values) {
      if (!value || typeof value !== 'object') continue
      const type = value['@type']
      jsonLd.push({
        type: Array.isArray(type)
          ? type.map(String)
          : type == null
            ? []
            : [String(type)],
        keys: Object.keys(value).sort(),
      })
    }
  }

  const hasNextData =
    /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>[\s\S]*?<\/script>/i.test(html)

  const applicationJsonScripts = Array.from(
    html.matchAll(
      /<script\b([^>]*)type=["']application\/json["']([^>]*)>([\s\S]*?)<\/script>/gi,
    ),
  ).map((match) => {
    const attrs = `${match[1]} ${match[2]}`
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1] ?? null
    return {
      id,
      bytes: Buffer.byteLength(match[3], 'utf8'),
    }
  })

  return {
    title,
    jsonLd,
    hasNextData,
    applicationJsonScripts,
  }
}

export async function inspectCaptureDirectory(rootDir) {
  const manifestPath = path.join(rootDir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  if (manifest.milestone !== 'M1 Data Feasibility') {
    throw new Error(`Unexpected milestone: ${manifest.milestone}`)
  }
  if (!manifest.bounded) {
    throw new Error('Capture manifest must be explicitly bounded')
  }
  if (!Array.isArray(manifest.results)) {
    throw new Error('Capture manifest results must be an array')
  }
  if (manifest.sourceCount !== manifest.results.length) {
    throw new Error(
      `Manifest sourceCount ${manifest.sourceCount} does not match results length ${manifest.results.length}`,
    )
  }

  const sources = []
  for (const result of manifest.results) {
    if (!isSafePathSegment(result?.id)) {
      throw new Error(`Unsafe capture source id: ${result?.id}`)
    }
    if (!isSafePathSegment(result?.supermarket)) {
      throw new Error(
        `Unsafe capture supermarket path segment for ${result.id}: ${result?.supermarket}`,
      )
    }

    const record = {
      id: result.id,
      supermarket: result.supermarket,
      kind: result.kind,
      success: Boolean(result.success),
      requestedUrl: result.requestedUrl,
      finalUrl: result.finalUrl ?? null,
      capturedAt: result.capturedAt,
      manifestSha256: result.sha256 ?? null,
      integrity: result.success ? 'unchecked' : 'not-applicable',
      html: null,
      error: result.error ?? null,
    }

    if (result.success) {
      const htmlPath = path.join(rootDir, result.supermarket, `${result.id}.html`)
      const html = await readFile(htmlPath, 'utf8')
      const actualSha256 = sha256(html)

      if (!result.sha256 || result.sha256 !== actualSha256) {
        throw new Error(
          `Capture integrity mismatch for ${result.id}: manifest=${result.sha256 || 'missing'} actual=${actualSha256}`,
        )
      }

      record.integrity = 'verified'
      record.html = inspectHtml(html)

      const provenance = {
        supermarket: result.supermarket,
        kind: result.kind,
        url: result.finalUrl ?? result.requestedUrl,
        capturedAt: result.capturedAt,
        sha256: result.sha256,
      }
      const schemaResults = extractJsonLdValues(html)
        .filter((value) => !value?.__supaParseError)
        .map((value) => parseSchemaOrgProduct(value, provenance))

      const observations = schemaResults.filter(
        (value) => value.type === 'observation',
      )
      record.schemaOrgProduct =
        observations.length === 1
          ? {
              type: 'observation',
              observation: observations[0].observation,
            }
          : {
              type: 'abstain',
              reasons:
                observations.length > 1
                  ? ['multiple independently parseable Product JSON-LD blocks']
                  : schemaResults.map((value) => value.reason).filter(Boolean),
            }
    }

    sources.push(record)
  }

  return {
    milestone: manifest.milestone,
    inspectedAt: new Date().toISOString(),
    captureStartedAt: manifest.startedAt,
    captureCompletedAt: manifest.completedAt,
    sourceCount: sources.length,
    successCount: sources.filter((source) => source.success).length,
    failureCount: sources.filter((source) => !source.success).length,
    integrityVerifiedCount: sources.filter(
      (source) => source.integrity === 'verified',
    ).length,
    sources,
  }
}

export async function main() {
  const rootDir = process.argv[2] || process.env.SUPA_CAPTURE_DIR
  if (!rootDir) {
    throw new Error(
      'Capture directory required as argv[2] or SUPA_CAPTURE_DIR',
    )
  }

  const report = await inspectCaptureDirectory(rootDir)
  const outputPath = path.join(rootDir, 'inspection.json')
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
