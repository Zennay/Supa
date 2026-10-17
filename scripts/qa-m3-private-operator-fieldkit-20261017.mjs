#!/usr/bin/env node
/**
 * Independent, read-only M3 fieldkit operator summary.
 *
 * Product-owned CLI #3785 has a permissive readFile entrypoint. This
 * QA-only replacement entrypoint uses the established owner/0600/fd-pinned
 * private reader, then independently cross-checks both canonical M3
 * aggregators against the exact same immutable byte snapshot.
 *
 * It NEVER verifies the retailer, public price, license or savings.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { types as nodeTypes } from 'node:util'
import { readPrivateM3OperatorFile } from './qa-m3-private-csv-report-binding-20261017.mjs'
import { buildPrivateM3FieldProgress } from './m3-private-field-progress.mjs'
import { buildM3OutstandingFieldActions } from './m3-private-outstanding-field-actions.mjs'

const REFUSE = 'Independent private M3 operator fieldkit refused'
const fail = () => { throw new Error(REFUSE) }
const EXPECTED = Object.freeze(['PLUS', 'DekaMarkt'])

function argumentsAsData(argv) {
  // Prevent Proxy or accessor-backed in-process CLI arguments executing code.
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) fail()
  const descriptors = Object.getOwnPropertyDescriptors(argv)
  const count = descriptors.length?.value
  if ((count !== 2 && count !== 3) ||
      Reflect.ownKeys(descriptors).length !== count + 1) fail()
  const values = []
  for (let i = 0; i < count; i++) {
    const d = descriptors[i]
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string' ||
        d.enumerable !== true) fail()
    values.push(d.value)
  }
  if (values[0] !== '--file' ||
      !values[1] || values[1] !== values[1].trim() ||
      values[1].startsWith('-') || values[1].includes('\0') ||
      (count === 3 && values[2] !== '--text')) fail()
  return { file: values[1], textMode: count === 3 }
}

export function inspectPrivateM3FieldKit(serialized, referenceNowMs = Date.now()) {
  try {
    if (typeof serialized !== 'string' || serialized.length > 2 * 1024 * 1024 ||
        !Number.isSafeInteger(referenceNowMs) || referenceNowMs < 0) fail()
    const status = buildPrivateM3FieldProgress(serialized, referenceNowMs)
    const work = buildM3OutstandingFieldActions(serialized, referenceNowMs)
    if (!status || status.schemaVersion !== 1 ||
        status.reportType !== 'm3-private-field-progress' ||
        status.evidenceStatus !== 'unverified-operator-draft' ||
        status.verifiedRetailerObservations !== false ||
        status.publicSavingsClaimEligible !== false ||
        status.progress?.expectedLines !== 22 ||
        work.schemaVersion !== 1 ||
        work.reportType !== 'm3-private-outstanding-field-actions' ||
        work.evidenceStatus !== 'unverified-operator-draft' ||
        work.expectedTotalLines !== 22 ||
        work.retailers?.length !== 2 ||
        status.progress.completeLines !== work.completedTotalLines ||
        status.progress.incompleteLines !== work.remainingTotalLines ||
        status.readyForPrivateReview !== work.readyForPrivateReview ||
        status.observationWindow.state !== work.observationWindowState) fail()

    const stores = [
      { from: status.baseline, action: work.retailers[0] },
      { from: status.candidate, action: work.retailers[1] },
    ].map(({ from, action }, i) => {
      if (from.retailer !== EXPECTED[i] || action.retailer !== EXPECTED[i] ||
          from.expectedLines !== 11 || action.expectedLines !== 11 ||
          from.completeLines !== action.completedLines ||
          action.completedLines + action.remainingLines !== 11 ||
          from.availabilityRecorded > 11) fail()
      return Object.freeze({
        retailer: EXPECTED[i],
        expectedLines: 11,
        completedLines: action.completedLines,
        missingLines: action.remainingLines,
        availabilityRecorded: from.availabilityRecorded,
      })
    })
    if (stores[0].completedLines + stores[1].completedLines !==
        work.completedTotalLines) fail()
    const metadataRemaining = status.progress.metadataTotal -
      status.progress.metadataCompleted
    if (!Number.isSafeInteger(metadataRemaining) || metadataRemaining < 0) fail()
    const blockers = []
    if (work.remainingTotalLines > 0) blockers.push('collect-remaining-physical-product-observations')
    if (metadataRemaining > 0) blockers.push('complete-operator-study-metadata')
    if (!work.readyForPrivateReview) blockers.push('canonical-private-field-review-not-ready')
    blockers.push('external-retailer-written-rights-not-independently-verified')
    blockers.push('real-paired-11x2-store-visit-not-independently-attested')
    blockers.push('physical-field-run-main-source-sha-not-independently-attested')
    blockers.push('permanent-vps-runner-proof-not-independently-attested')
    return Object.freeze({
      schemaVersion: 1,
      mode: 'independent-private-m3-operator-fieldkit',
      input: 'strict-private-owner-file-or-validated-in-process-bytes',
      projectMilestone: 'M3',
      dataStatus: 'unverified-operator-draft',
      stores,
      totalExpectedLines: 22,
      totalCompletedLines: work.completedTotalLines,
      totalMissingLines: work.remainingTotalLines,
      studyMetadataRemaining: metadataRemaining,
      studyReadinessIssueCount: status.progress.readinessIssueCount,
      observationWindowState: status.observationWindow.state,
      readyForPrivateHumanReview: work.readyForPrivateReview,
      independentRetailerRightsVerified: false,
      actualPairedShopVisitVerified: false,
      physicalCodePinVerified: false,
      permanentSelfHostedJobAttested: false,
      productionEnabled: false,
      publicSavingsClaimEligible: false,
      livePricesAvailable: false,
      externalRequests: 0,
      releaseDecision: 'hold',
      blockers,
    })
  } catch { fail() }
}

export function renderPrivateM3FieldKitText(report) {
  // Only fixed Dutch prose + small bounded numeric aggregates from a locally
  // validated QA report. Never interpolate product names or private metadata.
  try {
    if (report?.mode !== 'independent-private-m3-operator-fieldkit' ||
        report.totalExpectedLines !== 22 || report.stores?.length !== 2 ||
        report.releaseDecision !== 'hold' ||
        report.publicSavingsClaimEligible !== false) fail()
    const lines = [
      'SUPA M3 · privé winkelmeting (niet onafhankelijk geverifieerd)',
      'Nog te verzamelen: ' + report.totalMissingLines + ' van 22 regels.',
      'PLUS: ' + report.stores[0].missingLines + ' van 11 open.',
      'DekaMarkt: ' + report.stores[1].missingLines + ' van 11 open.',
      'Studie-metadata open: ' + report.studyMetadataRemaining + '.',
      'Tijdvenster: ' + report.observationWindowState + '.',
      'Klaar voor menselijke privécontrole: ' +
        (report.readyForPrivateHumanReview ? 'ja' : 'nee') + '.',
      'M3 productievrijgave: NEE. Geen bewezen winkelprijzen/besparingen.',
    ]
    return lines.join('\n') + '\n'
  } catch { fail() }
}

export async function main(argv = process.argv.slice(2),
  write = chunk => process.stdout.write(chunk)) {
  try {
    const { file, textMode } = argumentsAsData(argv)
    const source = await readPrivateM3OperatorFile(file)
    const report = inspectPrivateM3FieldKit(source)
    write(textMode ? renderPrivateM3FieldKitText(report) :
      JSON.stringify(report, null, 2) + '\n')
    return report
  } catch { fail() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(REFUSE + '\n')
    process.exitCode = 2
  })
}
