import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { assessRetailerDiscovery } from './m5-audit-retailer-discovery.mjs'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'

const DISCOVERY = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const M1_GATE = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)

// Read-only reconciliation between exploratory M5 research and the canonical
// M1 two-store source gate. This cannot grant M5 production access.
export function reconcileRetailerRights(discovery, canonicalM1) {
  const candidates = assessRetailerDiscovery(discovery)
  const gate = evaluateSourcePermissionGate(canonicalM1)
  const ids = new Set(candidates.sources.map((candidate) => candidate.id))
  for (const id of gate.expectedSources) {
    if (!ids.has(id)) throw new Error('M5 discovery omitted an existing M1 retailer: ' + id)
  }
  const m1ById = new Map(canonicalM1.sources.map((source) =>
    [source.supermarket, source]))
  const sourceStatuses = candidates.sources.map((candidate) => {
    const canonical = m1ById.get(candidate.id)
    return {
      supermarket: candidate.id,
      marketListed: true,
      historicalM1TechnicalProof: Boolean(canonical),
      m1PermissionStatus: canonical?.permissionStatus ?? 'not-in-m1',
      m1ProductionEnabled: canonical?.productionEnabled ?? false,
      m5ProductionEnabled: false,
      m5PermissionStatus: 'unreviewed',
      nextStep: canonical?.productionEnabled
        ? 'Current M1 scope does not authorize M5 expansion'
        : canonical
          ? 'Resolve the existing M1 retailer rights question; verify M3 real field observations separately'
          : 'Review retailer identity, legal permissions, source access and region before any M5 work',
    }
  })
  return {
    version: 1,
    currentMilestone: 'M3 — genuine 11+11 PLUS / DekaMarkt field evidence pending',
    m1ReviewedAt: gate.reviewedAt,
    m1ProductionReady: gate.productionReady,
    m5Eligible: false,
    productionReady: false,
    m5SourceCount: sourceStatuses.length,
    m1ExpectedCount: gate.expectedSources.length,
    m1BlockedCount: gate.blockers.length,
    blockedForM5: sourceStatuses.length,
    sourceStatuses,
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== '--require-m5-ready') ||
      args.filter((arg) => arg === '--require-m5-ready').length > 1) {
    throw new Error('Usage: node scripts/m5-reconcile-retailer-rights.mjs [--require-m5-ready]')
  }
  const [discovery, gate] = await Promise.all([
    readFile(DISCOVERY, 'utf8'), readFile(M1_GATE, 'utf8'),
  ])
  const summary = reconcileRetailerRights(JSON.parse(discovery), JSON.parse(gate))
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
  if (args.includes('--require-m5-ready')) process.exitCode = 2
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
