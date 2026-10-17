#!/usr/bin/env node
/**
 * Independent, read-only M3 permanent VPS trigger inventory (#2833).
 *
 * This is NOT the runner, an authorization grant or a proof of actual
 * self-hosted execution. It describes which currently tracked, strictly
 * scoped M3 source/test changes do not START the permanent workflow.
 * The existing workflow belongs to the peer CI owner (#2604); this tool
 * must not edit it, trigger a runner or bypass same-repo/fork constraints.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'

const REFUSE = 'Independent M3 permanent trigger inventory refused'
const WORKFLOW = '.github/workflows/m3-observed-week-report.yml'
const REFUSE_RELEASE = 'hold-permanent-m3-vps-trigger-coverage'
const refusal = () => { throw new Error(REFUSE) }

const inventoryGroups = Object.freeze([
  { name: 'm3-source-scripts', directory: 'scripts',
    match: /^(?:m3-|qa-m3-)[a-zA-Z0-9_-]+\.mjs$/u },
  { name: 'm3-dedicated-tests', directory: 'tests',
    match: /^(?:m3-|qa-m3-|product-m3-)[a-zA-Z0-9_-]+\.test\.mjs$/u },
])

// Source/owner paths outside dynamic M3-prefixed scripts/tests. Preserve
// existing front-end, planner, rights, package and permission gate coverage.
const manualCriticalPaths = Object.freeze([
  WORKFLOW,
  'package.json', 'package-lock.json',
  'src/data/m2Fixture.ts',
  'src/domain/decimalPackArithmetic.ts',
  'src/domain/basket.ts',
  'src/domain/m3ObservationSheet.ts',
  'src/domain/observedBasketStudy.ts',
  'src/domain/matching.ts',
  'src/domain/basketComparison.ts',
  'src/domain/savingsAttribution.ts',
  'src/features/observation/ObservationView.tsx',
  'src/features/observation/observationCollectionUi.ts',
  'src/features/observation/observationNextStep.ts',
  'src/features/observation/observationRequiredLineField.ts',
  'scripts/m1-check-source-permission-gate.mjs',
  'evidence/m1/source-permission-gate.v1.json',
])

const isValidFile = name => /^[a-zA-Z0-9._/\-]+$/u.test(name) &&
  !name.includes('..') && !name.startsWith('/') && !name.includes('\\')

/**
 * Extract only the actual YAML on.pull_request.paths list. Elsewhere a
 * literal path, comment or quoted description MUST NOT count as a selector.
 * Reject ambiguous path selectors and duplicate YAML path entries.
 */
export function extractM3PullRequestPaths(workflow) {
  if (typeof workflow !== 'string' || workflow.length > 512 * 1024 ||
      workflow.includes('\0')) refusal()
  const lines = workflow.split(/\r?\n/u)
  let inside = false
  let inPaths = false
  let occurrences = 0
  const selectors = []
  for (const line of lines) {
    if (/^  pull_request:\s*$/u.test(line)) {
      if (++occurrences !== 1) refusal()
      inside = true
      inPaths = false
      continue
    }
    if (inside && /^  [a-zA-Z_][a-zA-Z_]*:/u.test(line)) break
    if (inside && /^    paths:\s*$/u.test(line)) {
      if (inPaths) refusal()
      inPaths = true
      continue
    }
    if (inPaths) {
      const m = /^      - ["']([^"']+)["']\s*$/u.exec(line)
      if (m) selectors.push(m[1])
      else if (line.trim() && !/^\s*#/u.test(line)) refusal()
    }
  }
  if (occurrences !== 1 || !inPaths || selectors.length < 1 ||
      new Set(selectors).size !== selectors.length) refusal()
  for (const selector of selectors) {
    if (selector.length > 240 || !/^[a-zA-Z0-9._/*\-]+$/u.test(selector) ||
        selector.includes('..') || selector.startsWith('/')) refusal()
  }
  return selectors
}

function safeScopedGlobPattern(selector) {
  // A pattern such as '**' or 'tests/**' would fire the VPS runner for
  // arbitrary unreviewed PR code. Only namespace-scoped M3 selectors are
  // counted toward closure. The existing observation/** remains a reviewed
  // boundary restricted to the observation UI subtree.
  if (selector === 'src/features/observation/**') {
    return /^src\/features\/observation\/.*$/u
  }
  if (!selector.includes('*')) return null
  if (!/^(?:scripts\/(?:m3-|qa-m3-)|tests\/(?:m3-|qa-m3-|product-m3-))/u.test(selector) ||
      selector.includes('**') || selector.includes('?') ||
      selector.split('*').length > 5) return null
  const pattern = selector.replace(/[.+^$()|[\]{}]/gu, '\\$&').replace(/\*/gu, '[^/]*')
  return new RegExp('^' + pattern + '$', 'u')
}

export function selectorCoversM3File(path, selector) {
  if (!isValidFile(path) || typeof selector !== 'string') return false
  if (path === selector) return true
  const scoped = safeScopedGlobPattern(selector)
  return scoped?.test(path) ?? false
}

export function auditM3TriggerClosure(workflow, inventory) {
  const selectors = extractM3PullRequestPaths(workflow)
  if (!Array.isArray(inventory) || nodeTypes.isProxy(inventory) ||
      inventory.length > 3000) refusal()
  const entries = inventory.map(item => {
    if (nodeTypes.isProxy(item) || item === null ||
        typeof item !== 'object' || Array.isArray(item) ||
        Object.getPrototypeOf(item) !== Object.prototype ||
        !Object.hasOwn(item, 'group') || !Object.hasOwn(item, 'path') ||
        typeof item.group !== 'string' || !/^[a-z0-9-]+$/u.test(item.group) ||
        typeof item.path !== 'string' || !isValidFile(item.path) ||
        Reflect.ownKeys(item).length !== 2) refusal()
    return { group: item.group, path: item.path }
  })
  if (!entries.some(x => x.path === WORKFLOW) ||
      new Set(entries.map(x => x.path)).size !== entries.length) refusal()
  const sorted = entries.toSorted((a, b) => a.path.localeCompare(b.path, 'en'))
  const uncovered = sorted.filter(x => !selectors.some(s => selectorCoversM3File(x.path, s)))
  const groupNames = [...new Set(sorted.map(x => x.group))].sort()
  const groups = groupNames.map(name => {
    const required = sorted.filter(x => x.group === name).length
    const missing = uncovered.filter(x => x.group === name).length
    return { name, required, covered: required - missing, missing }
  })
  const invalidBroadSelectors = selectors.filter(
    selector => selector.includes('*') && safeScopedGlobPattern(selector) === null)
  return Object.freeze({
    schemaVersion: 1,
    mode: 'independent-static-m3-permanent-vps-trigger-inventory',
    workflow: WORKFLOW,
    candidatePathCount: sorted.length,
    coveredPathCount: sorted.length - uncovered.length,
    missingPathCount: uncovered.length,
    missingPaths: uncovered.map(x => x.path),
    groups,
    broadOrUnreviewedWildcardSelectors: invalidBroadSelectors,
    pathCoverageComplete: uncovered.length === 0 &&
      invalidBroadSelectors.length === 0,
    selfHostedRunnerExecutedAndAttested: false,
    productionReady: false,
    legalRetailerRightsVerified: false,
    genuinePairedObservationVerified: false,
    sourceCodePinPersistedAndVerified: false,
    m3ExitProven: false,
    publicSavingsClaimEligible: false,
    releaseDecision: REFUSE_RELEASE,
  })
}

export async function collectM3TriggerCandidates(root) {
  if (typeof root !== 'string' || !root) refusal()
  const groups = []
  for (const { name, directory, match } of inventoryGroups) {
    const filenames = await readdir(join(root, directory))
    for (const filename of filenames.filter(x => match.test(x)).sort()) {
      groups.push({ group: name, path: directory + '/' + filename })
    }
  }
  for (const path of manualCriticalPaths) {
    // Fixed known tracked source files, not arbitrary caller-supplied paths.
    groups.push({ group: 'm3-explicit-dependencies', path })
  }
  return groups
}

function inertArgs(argv) {
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) refusal()
  const descriptors = Object.getOwnPropertyDescriptors(argv)
  const length = descriptors.length?.value
  if (![0, 1].includes(length) ||
      Reflect.ownKeys(descriptors).length !== length + 1) refusal()
  if (length === 1 &&
      (!Object.hasOwn(descriptors[0] ?? {}, 'value') ||
        descriptors[0].value !== '--require-closure')) refusal()
  return length === 1
}

export async function main(argv = process.argv.slice(2),
  write = line => process.stdout.write(line)) {
  try {
    const requireClosure = inertArgs(argv)
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const workflow = await readFile(join(root, WORKFLOW), 'utf8')
    const report = auditM3TriggerClosure(workflow,
      await collectM3TriggerCandidates(root))
    write(JSON.stringify(report, null, 2) + '\n')
    if (requireClosure && !report.pathCoverageComplete) process.exitCode = 2
    return report
  } catch {
    refusal()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(REFUSE + '\n')
    process.exitCode = 2
  })
}
