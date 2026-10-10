import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RESEARCH_SOURCES } from './m1-multistore-research.mjs'
import { auditCaptureFiles } from './m1-research-snapshot-audit.mjs'

// Offline only. This lists counts of private capture pairs, never product data,
// filenames, raw HTML, prices or full source URLs.
const MAX_SOURCE_ENTRIES = 500
const CAPTURE_FILE = /^(capture-[0-9]{13}-[0-9]+)\.(html|json)$/

function summary(status, sources, unexpectedRootEntries = 0) {
  const totals = { manualReview: 0, rejected: 0, incomplete: 0, unexpected: unexpectedRootEntries }
  for (const source of sources) {
    for (const category of Object.keys(totals)) totals[category] += source[category]
  }
  return {
    status,
    totals,
    sources,
    semanticVerified: false,
    livePriceVerified: false,
    publicSavingsClaimEligible: false,
  }
}

function perSource(id) {
  return { sourceId: id, manualReview: 0, rejected: 0, incomplete: 0, unexpected: 0 }
}

async function directoryEntries(path) {
  let stat
  try { stat = await lstat(path) }
  catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false
  return readdir(path, { withFileTypes: true })
}

/**
 * Enumerate private, previously captured research pairs and audit each pair
 * with the fixed-source SHA/time/metadata gate. Never downloads retail pages.
 * File-level exceptions are converted into a generic rejected count.
 */
export async function inventoryResearchSnapshots({
  outputDir = join('artifacts', 'm1-multistore-research'),
  nowMs = Date.now(),
} = {}) {
  const sources = RESEARCH_SOURCES.map(source => perSource(source.id))
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    return summary('rejected', sources, 1)
  }
  const root = await directoryEntries(outputDir)
  if (root === null) return summary('no-captures', sources)
  if (root === false) return summary('rejected', sources, 1)
  const known = new Set(RESEARCH_SOURCES.map(source => source.id))
  // Do not traverse or expose unexpected directories or files.
  const unexpectedRootEntries = root.filter(entry => !known.has(entry.name)).length
  for (const source of sources) {
    const dir = join(outputDir, source.sourceId)
    const entries = await directoryEntries(dir)
    if (entries === null) continue
    if (entries === false) {
      source.unexpected++
      continue
    }
    if (entries.length > MAX_SOURCE_ENTRIES) {
      source.unexpected += entries.length
      continue
    }
    const stems = new Map()
    for (const entry of entries) {
      const match = CAPTURE_FILE.exec(entry.name)
      if (!match || !entry.isFile()) {
        source.unexpected++
        continue
      }
      const [, stem, extension] = match
      if (!stems.has(stem)) stems.set(stem, new Set())
      stems.get(stem).add(extension)
    }
    for (const [stem, extensions] of stems) {
      if (!extensions.has('html') || !extensions.has('json')) {
        source.incomplete++
        continue
      }
      try {
        const result = await auditCaptureFiles({
          sourceId: source.sourceId, stem, outputDir, nowMs,
        })
        if (result.status === 'manual-review') source.manualReview++
        else source.rejected++
      } catch {
        source.rejected++
      }
    }
  }
  const totals = summary('no-captures', sources, unexpectedRootEntries).totals
  const status = totals.rejected || totals.incomplete || totals.unexpected
    ? 'rejected'
    : totals.manualReview ? 'manual-review' : 'no-captures'
  return summary(status, sources, unexpectedRootEntries)
}

export async function main(args = process.argv.slice(2), log = console.log) {
  if (args.length !== 1 || args[0] !== '--inventory') {
    throw new Error('usage: --inventory')
  }
  const result = await inventoryResearchSnapshots()
  log(JSON.stringify(result))
  return result.status === 'manual-review' ? 0 : result.status === 'no-captures' ? 2 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main() }
  catch {
    console.error('private research inventory failed')
    process.exitCode = 1
  }
}
