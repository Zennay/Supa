#!/usr/bin/env node
/**
 * Local/offline Node runtime smoke for the permanent SUPA M3 runner (#2833).
 * Does not run a workflow, install Node, touch systemd, perform retailer HTTP,
 * inspect/store real observations or grant any M3 release entitlement.
 *
 * A runner using actions/setup-node MUST execute this smoke *after* setup
 * because the effective GitHub-setup binary may differ from the host default.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'

const ERROR = 'Independent M3 runtime preflight refused'
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REFUSE = () => { throw new Error(ERROR) }
const PROBES = Object.freeze([
  Object.freeze({
    label: 'observation-typescript-module',
    entry: './src/domain/m3ObservationSheet.ts',
  }),
  Object.freeze({
    label: 'field-converter-and-assessor-module',
    entry: './scripts/m3-build-observed-study.mjs',
  }),
])

/**
 * Pure evidence summary. Even a passing local binary does not attest the
 * actual permanent self-hosted GitHub job, retailer rights or field evidence.
 */
export function classifyM3RuntimeProbes(probes, nodeVersion) {
  if (nodeTypes.isProxy(probes) || !Array.isArray(probes) ||
      Object.getPrototypeOf(probes) !== Array.prototype ||
      typeof nodeVersion !== 'string' ||
      !/^v\d+\.\d+\.\d+$/u.test(nodeVersion)) REFUSE()
  // Programmatic callers may supply an accessor-backed or sparse Array.
  // Copy only its exact own enumerable data descriptors, like the CLI gate.
  const descriptors = Object.getOwnPropertyDescriptors(probes)
  if (descriptors.length?.value !== PROBES.length ||
      Reflect.ownKeys(descriptors).length !== PROBES.length + 1) REFUSE()
  const expectedNames = PROBES.map(p => p.label)
  const observations = []
  for (let i = 0; i < PROBES.length; i++) {
    const descriptor = descriptors[i]
    if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true) REFUSE()
    const item = descriptor.value
    if (item === null || typeof item !== 'object' || Array.isArray(item) ||
        nodeTypes.isProxy(item) ||
        Object.getPrototypeOf(item) !== Object.prototype) REFUSE()
    const name = Object.getOwnPropertyDescriptor(item, 'name')
    const status = Object.getOwnPropertyDescriptor(item, 'ok')
    if (!name || !status || !Object.hasOwn(name, 'value') ||
        !Object.hasOwn(status, 'value') ||
        name.value !== expectedNames[i] || typeof status.value !== 'boolean' ||
        Reflect.ownKeys(item).length !== 2) REFUSE()
    observations.push(Object.freeze({ name: name.value, passed: status.value }))
  }
  const ready = observations.every(x => x.passed)
  return Object.freeze({
    schemaVersion: 1,
    mode: 'independent-local-m3-runner-runtime-smoke',
    nodeVersion,
    localRuntimeReadyForM3Imports: ready,
    probeResults: observations,
    verifiedPermanentSelfHostedJob: false,
    officialGithubRunnerSetupNodeVerified: false,
    sourceRightsVerified: false,
    genuinePairedStoreObservationsVerified: false,
    sourceCodePinPersistedAndVerified: false,
    productionReady: false,
    m3ExitProven: false,
    publicSavingsClaimEligible: false,
    releaseDecision: ready
      ? 'runtime-local-capable-not-a-runner-attestation'
      : 'hold-local-node-runtime-incompatible',
  })
}

/**
 * Exactly two fixed, bounded local TypeScript import probes. This executable
 * cannot be directed to run a user-supplied file, shell or arbitrary binary.
 * Capture child stderr internally but NEVER print it, private cwd or argv.
 */
export function inspectCurrentM3NodeBinary() {
  const probes = PROBES.map(({ label, entry }) => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval', 'await import(' + JSON.stringify(entry) + ')',
    ], {
      cwd: REPOSITORY_ROOT,
      timeout: 10000,
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      windowsHide: true,
    })
    return { name: label, ok: result.status === 0 &&
      result.error == null && result.signal == null }
  })
  return classifyM3RuntimeProbes(probes, process.version)
}

function inertArgs(argv) {
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) REFUSE()
  const descriptors = Object.getOwnPropertyDescriptors(argv)
  const length = descriptors.length?.value
  if ((length !== 0 && length !== 1) ||
      Reflect.ownKeys(descriptors).length !== length + 1) REFUSE()
  if (length === 1 &&
      (!Object.hasOwn(descriptors[0] ?? {}, 'value') ||
        descriptors[0].value !== '--strict')) REFUSE()
  return length === 1
}

export async function main(argv = process.argv.slice(2),
  write = value => process.stdout.write(value)) {
  const strict = inertArgs(argv)
  const report = inspectCurrentM3NodeBinary()
  write(JSON.stringify(report) + '\n')
  if (strict && !report.localRuntimeReadyForM3Imports) process.exitCode = 2
  return report
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(ERROR + '\n')
    process.exitCode = 2
  })
}
