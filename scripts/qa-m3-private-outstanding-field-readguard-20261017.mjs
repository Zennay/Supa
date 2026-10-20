#!/usr/bin/env node
// QA-only safe operator entry point for the canonical 11 + 11 M3 checklist.
// Source-owned CLI remains untouched. A valid checklist does not establish
// real retailer observations, permissions or a public financial claim.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { buildM3OutstandingFieldActions } from './m3-private-outstanding-field-actions.mjs'
import { readPrivateM3OperatorFile } from './qa-m3-private-csv-report-binding-20261017.mjs'

const REFUSAL = 'Private M3 outstanding checklist refused'
const refuse = () => { throw new Error(REFUSAL) }

export async function safeM3OutstandingFieldChecklist(file, referenceNowMs = Date.now()) {
  try {
    if (typeof file !== 'string' || !file || file !== file.trim() ||
        file.startsWith('-') || file.includes('\0') ||
        !Number.isSafeInteger(referenceNowMs) || referenceNowMs < 0) refuse()
    const serialized = await readPrivateM3OperatorFile(file)
    const result = buildM3OutstandingFieldActions(serialized, referenceNowMs)
    if (result.schemaVersion !== 1 ||
        result.reportType !== 'm3-private-outstanding-field-actions' ||
        result.evidenceStatus !== 'unverified-operator-draft' ||
        result.verifiedRetailerObservations !== false ||
        result.publicSavingsClaimEligible !== false ||
        result.expectedTotalLines !== 22 ||
        result.retailers?.length !== 2 ||
        result.retailers[0]?.retailer !== 'PLUS' ||
        result.retailers[1]?.retailer !== 'DekaMarkt' ||
        result.retailers.some(r => r.expectedLines !== 11 ||
          r.completedLines + r.remainingLines !== 11 ||
          r.pending.length !== r.remainingLines)) refuse()
    return result
  } catch {
    refuse()
  }
}

function renderChecklist(report) {
  const lines = [
    'SUPA M3 · privé boodschappenveldkaart (niet geverifieerd)',
    'Nog te controleren: ' + report.remainingTotalLines + '/22.',
  ]
  for (const retailer of report.retailers) {
    lines.push('', retailer.retailer + ': ' + retailer.remainingLines + '/11 open')
    if (retailer.pending.length === 0) lines.push('  Alles ingevuld; bronbewijs nog niet beoordeeld.')
    for (const line of retailer.pending) {
      // Ingredient labels and quantities are ALWAYS canonical planner data.
      lines.push('  - ' + line.ingredientLabel + ' (' + line.requiredAmount +
        ' ' + line.requiredUnit + '): ' +
        (line.action === 'record-availability'
          ? 'beschikbaarheid invullen' : 'product, verpakking en prijs invullen'))
    }
  }
  lines.push('', 'Privéreview mogelijk: ' + (report.readyForPrivateReview ? 'ja' : 'nee'),
    'Geen onafhankelijke PLUS/Deka-prijsverificatie of publieke besparingsclaim.')
  return lines.join('\n') + '\n'
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (!Array.isArray(argv) || (argv.length !== 1 &&
        !(argv.length === 2 && argv[1] === '--text')) ||
        argv.some(value => typeof value !== 'string')) refuse()
    const report = await safeM3OutstandingFieldChecklist(argv[0])
    process.stdout.write(argv.length === 2
      ? renderChecklist(report) : JSON.stringify(report) + '\n')
    return report
  } catch {
    refuse()
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(REFUSAL + '\n')
    process.exitCode = 1
  })
}
