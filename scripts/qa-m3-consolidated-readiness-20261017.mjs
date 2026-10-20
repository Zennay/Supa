#!/usr/bin/env node
/**
 * Independent M3 operational QA gate, not a product release decision.
 *
 * Runs the real, local six-shape reviewed-retailer -> SQLite quality pipeline,
 * the canonical permissions document through the independent conservative
 * documentary audit, and the actual permanent-runner PR-path inventory.
 * Neither passing synthetic QA nor source-controlled permission strings can
 * certify legal rights, a human paired basket, a pinned field run, or a
 * successfully attested self-hosted production gate.
 *
 * No retailer HTTP, production mutations, private field artifacts, or raw
 * prices/URLs leave this command.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'
import { auditM3DocumentaryRights } from './qa-m3-documentary-rights-audit-20261017.mjs'
import {
  auditM3TriggerClosure,
  collectM3TriggerCandidates,
} from './qa-m3-permanent-runner-trigger-inventory-20261017.mjs'
import { buildOfflineQualityBundle } from './qa-retailer-offline-quality-bundle.mjs'

const REFUSE = 'Independent M3 consolidated readiness check refused'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKFLOW = '.github/workflows/m3-observed-week-report.yml'
const RIGHTS = 'evidence/m1/source-permission-gate.v1.json'
const refuse = () => { throw new Error(REFUSE) }

function strictArguments(argv) {
  // Programmatic invocations may pass forged arrays, Proxy traps or getters.
  // No arbitrary file, URL, field-data, publish or --ignore-blockers option.
  if (!Array.isArray(argv) || nodeTypes.isProxy(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) refuse()
  const descriptors = Object.getOwnPropertyDescriptors(argv)
  const size = descriptors.length?.value
  if (![0, 1].includes(size) || Reflect.ownKeys(descriptors).length !== size + 1) refuse()
  if (size === 1 &&
      (!Object.hasOwn(descriptors[0] ?? {}, 'value') ||
        descriptors[0].value !== '--require-release')) refuse()
  return size === 1
}

function validHistoricalReport(value) {
  return value?.mode === 'historical-offline-retailer-quality-bundle' &&
    value.sourceKinds === 6 && value.snapshots === 6 &&
    value.sourceFactParityVerified === true &&
    Number.isSafeInteger(value.verifiedOriginalObservations) &&
    value.verifiedOriginalObservations > 0 &&
    value.historicalOnly === true &&
    value.trustedCurrentPrices === false &&
    value.productionEnabled === false &&
    value.publicSavingsClaimEligible === false &&
    value.externalRequests === 0 &&
    value.storeQuality?.plus?.captureKinds === 3 &&
    value.storeQuality?.dekamarkt?.captureKinds === 3
}

/** Real checks only. No input paths, rights grants, retailer HTTP or claims. */
export async function inspectIndependentM3Readiness() {
  try {
    const [documentText, workflowText] = await Promise.all([
      readFile(join(root, RIGHTS), 'utf8'),
      readFile(join(root, WORKFLOW), 'utf8'),
    ])
    const documentary = auditM3DocumentaryRights(JSON.parse(documentText))
    const candidates = await collectM3TriggerCandidates(root)
    const triggers = auditM3TriggerClosure(workflowText, candidates)
    // Use an explicit UTC second to retain the same deterministic as-of
    // format expected by the actual archived six-shape SQLite QA bundle.
    const historical = await buildOfflineQualityBundle(
      new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    )
    if (documentary?.releaseDecision !== 'hold' ||
        documentary.independentlyVerifiedLegalRights !== false ||
        documentary.productionReady !== false ||
        documentary.publicSavingsClaimEligible !== false ||
        documentary.reviewedSourceCount !== 2 ||
        triggers?.selfHostedRunnerExecutedAndAttested !== false ||
        triggers.productionReady !== false ||
        !Number.isSafeInteger(triggers.missingPathCount) ||
        triggers.missingPathCount < 0 ||
        !validHistoricalReport(historical)) refuse()

    const blockers = [
      'written-plus-dekamarkt-source-rights-not-independently-verified',
      'human-observed-same-context-11x2-basket-not-independently-verified',
      'physical-field-run-source-sha-not-independently-pinned',
      'permanent-self-hosted-m3-job-not-attested',
    ]
    if (!triggers.pathCoverageComplete)
      blockers.push('permanent-m3-pr-trigger-coverage-incomplete')
    if (documentary.unsafeDocumentaryUrls > 0)
      blockers.push('unsafe-documentary-source-reference')

    // Deliberately no raw missing paths, original retailer source material,
    // unredacted evidence references, private field prices or customer data.
    return Object.freeze({
      schemaVersion: 1,
      mode: 'independent-m3-consolidated-private-qa',
      milestone: 'M3',
      historicalOfflineSixShapeParityPassed: true,
      reviewedHistoricalSnapshots: historical.snapshots,
      reviewedHistoricalObservations: historical.verifiedOriginalObservations,
      historicalCurrentPricesTrusted: false,
      independentRightsAuditRan: true,
      underlyingSourceGateClaimsReady: documentary.underlyingGateClaimsReady,
      writtenRetailerRightsIndependentlyVerified: false,
      documentaryUnsafeReferenceCount: documentary.unsafeDocumentaryUrls,
      permanentRunnerPrPathCoverageComplete: triggers.pathCoverageComplete,
      permanentRunnerMissingTriggerPathCount: triggers.missingPathCount,
      permanentSelfHostedRunAttested: false,
      verifiedHumanPairedPhysicalObservations: false,
      verifiedPhysicalFieldRunCodePin: false,
      allM3ExitGatesSatisfied: false,
      publicSavingsClaimEligible: false,
      productionReady: false,
      externalRequests: 0,
      blockers,
      releaseDecision: 'hold',
    })
  } catch {
    refuse() // Uniform no-leak failure. A broken audit is NEVER a pass.
  }
}

export async function main(argv = process.argv.slice(2),
  write = value => process.stdout.write(value)) {
  const requireRelease = strictArguments(argv)
  const report = await inspectIndependentM3Readiness()
  write(JSON.stringify(report, null, 2) + '\n')
  // Normal mode: successful *inspection*. Strict mode: NOT releaseable.
  if (requireRelease) process.exitCode = 2
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write(REFUSE + '\n')
    process.exitCode = 2
  })
}
