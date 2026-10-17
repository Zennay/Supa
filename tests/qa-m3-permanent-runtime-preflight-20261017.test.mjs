import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  classifyM3RuntimeProbes,
  inspectCurrentM3NodeBinary,
  main,
} from '../scripts/qa-m3-permanent-runtime-preflight-20261017.mjs'

const CLI = fileURLToPath(new URL(
  '../scripts/qa-m3-permanent-runtime-preflight-20261017.mjs',
  import.meta.url))
const ready = () => [
  { name: 'observation-typescript-module', ok: true },
  { name: 'field-converter-and-assessor-module', ok: true },
]
const RUN = (...args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 20000,
})

test('pure M3 Node capability contract stays explicit and cannot imply permanent VPS attestation or legal rights', () => {
  const approved = classifyM3RuntimeProbes(ready(), 'v24.19.0')
  assert.equal(approved.localRuntimeReadyForM3Imports, true)
  assert.equal(approved.verifiedPermanentSelfHostedJob, false)
  assert.equal(approved.officialGithubRunnerSetupNodeVerified, false)
  assert.equal(approved.sourceRightsVerified, false)
  assert.equal(approved.genuinePairedStoreObservationsVerified, false)
  assert.equal(approved.sourceCodePinPersistedAndVerified, false)
  assert.equal(approved.productionReady, false)
  assert.equal(approved.m3ExitProven, false)
  assert.equal(approved.publicSavingsClaimEligible, false)
  assert.equal(approved.releaseDecision, 'runtime-local-capable-not-a-runner-attestation')
  assert.ok(Object.isFrozen(approved))
  for (const failedIndex of [0, 1]) {
    const probes = ready()
    probes[failedIndex].ok = false
    const denied = classifyM3RuntimeProbes(probes, 'v22.22.1')
    assert.equal(denied.localRuntimeReadyForM3Imports, false)
    assert.equal(denied.releaseDecision, 'hold-local-node-runtime-incompatible')
    assert.equal(denied.publicSavingsClaimEligible, false)
  }
})

test('actual current Node binary safely imports M3 observation schema and study converter via bounded child processes', () => {
  const result = inspectCurrentM3NodeBinary()
  assert.equal(result.nodeVersion, process.version)
  assert.equal(result.localRuntimeReadyForM3Imports, true,
    'the verified GitHub-hosted Node environment must import both M3 module graphs')
  assert.deepEqual(result.probeResults, [
    { name: 'observation-typescript-module', passed: true },
    { name: 'field-converter-and-assessor-module', passed: true },
  ])
  assert.equal(result.verifiedPermanentSelfHostedJob, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(result), /participantKey|priceCents|\.json|\/home\/|credentials/iu)
})

test('CLI success and strict-mode success do not leak stderr, private fields or fabricate release', () => {
  for (const args of [[], ['--strict']]) {
    const result = RUN(...args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.localRuntimeReadyForM3Imports, true)
    assert.equal(report.officialGithubRunnerSetupNodeVerified, false)
    assert.equal(report.verifiedPermanentSelfHostedJob, false)
    assert.equal(report.sourceRightsVerified, false)
    assert.equal(report.genuinePairedStoreObservationsVerified, false)
    assert.equal(report.m3ExitProven, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.doesNotMatch(result.stdout, /\/home\/|participantKey|priceCents|password|token/iu)
  }
})

test('malformed probe facts, private getters, Proxy and inherited data cannot turn incompatibility into READY', () => {
  let checked = 0
  for (const mutate of [
    arr => { arr[0].ok = 'true' },
    arr => { arr[1].ok = null },
    arr => { arr[0].name = 'other' },
    arr => { arr[0].extra = true },
    arr => { delete arr[0].ok },
    arr => { arr.length = 1 },
    arr => { arr.length = 3 },
    arr => { Object.setPrototypeOf(arr[0], { ok: true }) },
  ]) {
    const probes = ready()
    mutate(probes)
    assert.throws(() => classifyM3RuntimeProbes(probes, 'v24.19.0'),
      /Independent M3 runtime preflight refused/u)
    checked++
  }
  for (const location of [0, 1]) {
    const probes = ready()
    let getterCalls = 0
    Object.defineProperty(probes[location], 'ok', {
      enumerable: true, get() { getterCalls++; return true },
    })
    assert.throws(() => classifyM3RuntimeProbes(probes, 'v24.19.0'),
      /Independent M3 runtime preflight refused/u)
    assert.equal(getterCalls, 0)
    checked++
  }
  const proxied = ready()
  let calls = 0
  proxied[0] = new Proxy(proxied[0], {
    get() { calls++; throw Error('unsafe trap') },
    getPrototypeOf() { calls++; throw Error('unsafe trap') },
  })
  assert.throws(() => classifyM3RuntimeProbes(proxied, 'v24.19.0'),
    /Independent M3 runtime preflight refused/u)
  assert.equal(calls, 0)
  checked++
  for (const unsafeVersion of [null, 22, '', 'Node 24.19.0', 'v22.22.1\nsecret']) {
    assert.throws(() => classifyM3RuntimeProbes(ready(), unsafeVersion),
      /Independent M3 runtime preflight refused/u)
    checked++
  }
  assert.equal(checked, 16)
})

test('operator entrypoint refuses unexpected args and in-process accessor/Proxy arrays before probing', async () => {
  for (const args of [['--help'], ['--strict', '--force'], ['--require-release']]) {
    const child = RUN(...args)
    assert.notEqual(child.status, 0)
    assert.equal(child.stdout, '')
    assert.equal(child.stderr, 'Independent M3 runtime preflight refused\n')
  }
  let calls = 0
  const unsafe = new Proxy(['--strict'], {
    get() { calls++; throw Error('unsafe argv trap') },
    getPrototypeOf() { calls++; throw Error('unsafe argv trap') },
  })
  await assert.rejects(main(unsafe, () => { throw Error('must not output') }),
    /Independent M3 runtime preflight refused/u)
  assert.equal(calls, 0)
  const getter = ['--strict']
  Object.defineProperty(getter, '0', {
    enumerable: true, get() { calls++; throw Error('unsafe getter') },
  })
  await assert.rejects(main(getter, () => { throw Error('must not output') }),
    /Independent M3 runtime preflight refused/u)
  assert.equal(calls, 0)
})
