#!/usr/bin/env node
/**
 * QA-only, executable owner-review patch preview for missing M3 persistent
 * self-hosted PR triggers (#2833). NEVER edits the owned workflow, starts a
 * runner, or implies that simulated path coverage is a real VPS attestation.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'
import {
  auditM3TriggerClosure,
  collectM3TriggerCandidates,
  extractM3PullRequestPaths,
  selectorCoversM3File,
} from './qa-m3-permanent-runner-trigger-inventory-20261017.mjs'

const WORKFLOW = '.github/workflows/m3-observed-week-report.yml'
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const REFUSE = 'Independent M3 trigger owner patch preview refused'
const fail = () => { throw new Error(REFUSE) }
const allowedScoped = new Set([
  'scripts/m3-*.mjs', 'scripts/qa-m3-*.mjs',
  'tests/m3-*.test.mjs', 'tests/qa-m3-*.test.mjs',
  'tests/product-m3-*.test.mjs',
])
function argumentMode(argv) {
  if (!Array.isArray(argv) || nodeTypes.isProxy(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) fail()
  const desc = Object.getOwnPropertyDescriptors(argv)
  const len = desc.length?.value
  if ((len !== 0 && len !== 1) || Reflect.ownKeys(desc).length !== len + 1) fail()
  if (len === 0) return 'json'
  if (!Object.hasOwn(desc[0] ?? {}, 'value') ||
      typeof desc[0].value !== 'string' || desc[0].enumerable !== true) fail()
  if (desc[0].value === '--selectors') return 'selectors'
  if (desc[0].value === '--require-real-coverage') return 'require'
  fail()
}

/** Pure in-memory proposer; never writes to GitHub workflow or filesystem. */
export function buildM3TriggerOwnerPatchPreview(workflow, inventory) {
  try {
    const original = extractM3PullRequestPaths(workflow)
    const before = auditM3TriggerClosure(workflow, inventory)
    if (before.broadOrUnreviewedWildcardSelectors.length ||
        before.candidatePathCount < 1 ||
        before.missingPathCount < 0 ||
        before.missingPaths.length !== before.missingPathCount) fail()

    const additions = before.ownerReviewCandidateSelectors.filter(
      selector => !original.includes(selector))
    if (new Set(additions).size !== additions.length) fail()
    const inventoryPaths = new Set(inventory.map(x => x.path))
    for (const selector of additions) {
      if (!allowedScoped.has(selector) && !inventoryPaths.has(selector)) fail()
      if (!before.missingPaths.some(path => selectorCoversM3File(path, selector))) fail()
      if (['**', 'tests/**', 'scripts/**', 'src/**'].includes(selector)) fail()
    }

    const marker = /^  workflow_dispatch:\s*$/gm
    if (workflow.match(marker)?.length !== 1) fail()
    const selectorLines = additions.map(p => '      - "' + p + '"')
    // Do not replace a stanza elsewhere: use an exact YAML anchor on the
    // current owner's main workflow. Existing entire job/permissions stay
    // untouched in this *in-memory simulation only*.
    const patched = workflow.replace(marker,
      selectorLines.join('\n') +
      (selectorLines.length ? '\n' : '') + '  workflow_dispatch:')
    const after = auditM3TriggerClosure(patched, inventory)
    if (!after.pathCoverageComplete || after.missingPathCount !== 0 ||
        after.broadOrUnreviewedWildcardSelectors.length !== 0 ||
        after.candidatePathCount !== before.candidatePathCount ||
        !patched.endsWith(workflow.slice(workflow.indexOf('  workflow_dispatch:')))) fail()
    if (additions.length === 0 && before.missingPathCount > 0) fail()

    return Object.freeze({
      schemaVersion: 1,
      mode: 'independent-m3-self-hosted-trigger-owner-patch-preview',
      workflow: WORKFLOW,
      originalPathCount: original.length,
      sourceTestDependencyCandidates: before.candidatePathCount,
      uncoveredBefore: before.missingPathCount,
      proposedAdditionalSelectors: additions,
      proposedSelectorYamlLines: selectorLines,
      simulatedUncoveredAfter: after.missingPathCount,
      simulatedPathCoverageComplete: true,
      actualWorkflowChanged: false,
      realWorkflowCoverageComplete: before.pathCoverageComplete,
      sourceOwnerMustApproveAndApply: true,
      selfHostedRunnerExecutedAndAttested: false,
      sourceRightsVerified: false,
      realHumanPairedObservationVerified: false,
      sourceCodePinVerified: false,
      productionReady: false,
      publicSavingsClaimEligible: false,
      releaseDecision: 'hold',
    })
  } catch { fail() }
}

export async function main(argv = process.argv.slice(2),
  write = data => process.stdout.write(data)) {
  const mode = argumentMode(argv)
  try {
    const [workflow, inventory] = await Promise.all([
      readFile(join(ROOT, WORKFLOW), 'utf8'),
      collectM3TriggerCandidates(ROOT),
    ])
    const report = buildM3TriggerOwnerPatchPreview(workflow, inventory)
    if (mode === 'selectors') {
      write('# QA OWNER REVIEW ONLY — add under on.pull_request.paths after approval\n' +
        report.proposedSelectorYamlLines.join('\n') + '\n')
    } else write(JSON.stringify(report, null, 2) + '\n')
    // Exit nonzero if called as a real coverage gate. A *simulated* complete
    // proposal must never make the current workflow appear fixed.
    if (mode === 'require' && !report.realWorkflowCoverageComplete)
      process.exitCode = 2
    return report
  } catch { fail() }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(REFUSE + '\n')
    process.exitCode = 2
  })
}
