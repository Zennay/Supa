import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'
import { scanOfflineRetailerMarkup, hasVerifiedSchemaProduct } from './retailer-offline-structural-scan.mjs'
import { assertObservedRetailerHtmlIdentity } from './retailer-offline-selector-discovery.mjs'
import { isAllowedM1RetailerSourcePath } from './retailer-source-route-safety.mjs'
import { admittedJsonScriptType, admittedRetailerScriptId } from './retailer-json-script-mime.mjs'
import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'
import { decodeExactRetailerHtmlBytes } from './retailer-private-html-byte-identity.mjs'

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}


function isSafePathSegment(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function admittedSourceUrl(record) {
  const hosts={plus:'www.plus.nl',dekamarkt:'www.dekamarkt.nl',ah:'www.ah.nl'}
  const raw=record.requestedUrl
  if (!Object.hasOwn(hosts,record.supermarket) || typeof raw !== 'string' ||
      (record.finalUrl != null && record.finalUrl !== raw))
    throw new Error('Capture source URL identity or redirect mismatch')
  let url
  try { url=new URL(raw) } catch { throw new Error('Invalid capture source URL') }
  const path=url.pathname
  const route=record.supermarket==='ah'
    ? record.kind==='product' && path.startsWith('/producten/product/') &&
      path.length > '/producten/product/'.length
    : ['product','catalog','offers'].includes(record.kind) &&
      isAllowedM1RetailerSourcePath(record.supermarket,record.kind,path)
  if (url.protocol!=='https:' || url.hostname!==hosts[record.supermarket] ||
      url.port || url.username || url.password || url.search || url.hash ||
      url.href!==raw || !route) throw new Error('Unapproved capture source URL identity')
  return raw
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function liveEmbeddedScripts(html) {
  // Inspect only live DOM scripts, never template/comment/quoted attribute text.
  // Reuse the source scanner that guards the private capture replay path.
  return scanOfflineRetailerMarkup(html,{includeScripts:true}).scripts
}

export function extractJsonLdValues(html) {
  const values=[]
  let scripts
  try { scripts=liveEmbeddedScripts(html) } catch { return [{__supaParseError:true}] }
  for(const script of scripts) {
    const type=admittedJsonScriptType(script.attrs.get('type'))
    if (type === null) { values.push({__supaParseError:true}); continue }
    if(type !== 'application/ld+json') continue
    if(script.attrs.has('src') || !script.content.trim()) {
      values.push({__supaParseError:true})
      continue
    }
    try { values.push(parseUniqueKeyRetailerJson(script.content.trim())) }
    catch { values.push({__supaParseError:true}) }
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

  let scripts=[]
  try { scripts=liveEmbeddedScripts(html) } catch { /* source refused */ }
  const applicationJsonScripts = scripts.filter(script =>
    !script.attrs.has('src') &&
    admittedJsonScriptType(script.attrs.get('type'))==='application/json')
    .map(script=>({
      id:admittedRetailerScriptId(script.attrs.get('id')) ?? null,
      bytes:Buffer.byteLength(script.content,'utf8'),
    }))
  const hasNextData=applicationJsonScripts.some(script=>script.id==='__NEXT_DATA__')

  return {
    title,
    jsonLd,
    hasNextData,
    applicationJsonScripts,
  }
}

export async function inspectCaptureDirectory(rootDir) {
  const manifestPath = path.join(rootDir, 'manifest.json')
  const manifestBytes = await readFile(manifestPath)
  if (manifestBytes.length > 512 * 1024) throw new Error('Capture manifest is oversized')
  const manifest = parseUniqueKeyRetailerJson(
    new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),512 * 1024)


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
      const sourceUrl=admittedSourceUrl(result)
      const htmlPath = path.join(rootDir, result.supermarket, `${result.id}.html`)
      // Hash the immutable ORIGINAL bytes. Decoding with replacement chars
      // before hashing could make a forged manifest refer to different HTML.
      const rawHtml = await readFile(htmlPath)
      const actualSha256 = sha256(rawHtml)

      if (!result.sha256 || result.sha256 !== actualSha256) {
        throw new Error(
          `Capture integrity mismatch for ${result.id}: manifest=${result.sha256 || 'missing'} actual=${actualSha256}`,
        )
      }

      const html = decodeExactRetailerHtmlBytes(rawHtml,5 * 1024 * 1024)
      const observed=scanOfflineRetailerMarkup(html)
      if (observed.baseHrefs.length>1 || observed.canonicalHrefs.length>1)
        throw new Error('Ambiguous capture canonical or base identity')
      assertObservedRetailerHtmlIdentity(sourceUrl,observed.baseHrefs,observed.canonicalHrefs)
      record.integrity = 'verified'
      record.html = inspectHtml(html)

      const provenance = {
        supermarket: result.supermarket,
        kind: result.kind,
        url: sourceUrl,
        capturedAt: result.capturedAt,
        sha256: result.sha256,
      }
      const schemaResults = extractJsonLdValues(html)
        // The generic Product parser accepts legacy short names. At the M1
        // source boundary, require explicit official Schema.org context or
        // absolute Product IRI before even proposing a priced observation.
        .filter((value) => !value?.__supaParseError && hasVerifiedSchemaProduct(value))
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
