import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  inspectIndependentM3Readiness,
  main,
} from '../scripts/qa-m3-consolidated-readiness-20261017.mjs'

const command = new URL('../scripts/qa-m3-consolidated-readiness-20261017.mjs', import.meta.url)
const run = (args = [], options = {}) => spawnSync(process.execPath,
  ['--experimental-strip-types', command.pathname, ...args],
  { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024, ...options })

function verifyHold(report) {
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.mode, 'independent-m3-consolidated-private-qa')
  assert.equal(report.milestone, 'M3')
  assert.equal(report.historicalOfflineSixShapeParityPassed, true)
  assert.equal(report.reviewedHistoricalSnapshots, 6)
  assert.equal(report.reviewedHistoricalObservations, 16)
  assert.equal(report.historicalCurrentPricesTrusted, false)
  assert.equal(report.independentRightsAuditRan, true)
  assert.equal(report.writtenRetailerRightsIndependentlyVerified, false)
  assert.equal(report.verifiedHumanPairedPhysicalObservations, false)
  assert.equal(report.verifiedPhysicalFieldRunCodePin, false)
  assert.equal(report.permanentSelfHostedRunAttested, false)
  assert.equal(report.allM3ExitGatesSatisfied, false)
  assert.equal(report.productionReady, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
  assert.equal(report.releaseDecision, 'hold')
  assert.ok(Number.isSafeInteger(report.permanentRunnerMissingTriggerPathCount))
  assert.equal(report.permanentRunnerPrPathCoverageComplete,
    report.permanentRunnerMissingTriggerPathCount === 0)
  assert.deepEqual(report.blockers.slice(0, 4), [
    'written-plus-dekamarkt-source-rights-not-independently-verified',
    'human-observed-same-context-11x2-basket-not-independently-verified',
    'physical-field-run-source-sha-not-independently-pinned',
    'permanent-self-hosted-m3-job-not-attested',
  ])
  assert.equal(report.blockers.includes('permanent-m3-pr-trigger-coverage-incomplete'),
    report.permanentRunnerMissingTriggerPathCount > 0)
  // This is an intentionally non-publishing aggregate protocol. It must not
  // reveal physical basket evidence, SKUs, URLs, tokens, or historical prices.
  const wire = JSON.stringify(report)
  assert.doesNotMatch(wire,
    /https?:\/\/|capture-\d|\.json\b|\.mjs\b|sourceProductId|currentPriceCents|offerPriceCents|participantKey|fieldRunCommitSha|FAKE_SECRET|Kippendij/i)
}

describe('independent M3 consolidated release HOLD contract', () => {
  it('actually executes six historical adapters, SQLite parity, rights and live workflow inventory without retailer HTTP', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = () => { fetchCalls++; throw new Error('external retailer HTTP forbidden') }
    try {
      verifyHold(await inspectIndependentM3Readiness())
      assert.equal(fetchCalls, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('real normal CLI prints exactly one private-safe report and leaves release on HOLD', () => {
    const child = run()
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stderr, '')
    verifyHold(JSON.parse(child.stdout))
  })

  it('--require-release refuses success even when all offline historical checks pass', () => {
    const child = run(['--require-release'])
    assert.equal(child.error, undefined)
    assert.equal(child.status, 2, child.stderr)
    assert.equal(child.stderr, '')
    verifyHold(JSON.parse(child.stdout))
  })

  it('two actual independent executions yield identical anonymized readiness; never claim live availability', async () => {
    const a = await inspectIndependentM3Readiness()
    const b = await inspectIndependentM3Readiness()
    verifyHold(a)
    assert.deepEqual(b, a)
    assert.equal(a.underlyingSourceGateClaimsReady, false)
  })

  it('rejects every publishing, privilege, remote URL and source-overwrite CLI variant before reporting', () => {
    for (const args of [
      ['--publish'], ['--ignore-blockers'], ['--approved'],
      ['--release', 'true'], ['--rights', 'https://example.invalid/rights'],
      ['--as-of', '2099-01-01'], ['--require-release', '--publish'],
      ['--set-production-ready'], ['--dir', '/tmp/real-operator-evidence'],
    ]) {
      const child = run(args)
      assert.equal(child.status, 2, args.join(' '))
      assert.equal(child.stdout, '')
      assert.match(child.stderr, /Independent M3 consolidated readiness check refused/)
      assert.doesNotMatch(child.stderr, /https?:\/\/|real-operator-evidence|2099/)
    }
  })

  it('programmatic argv Proxy and getters are rejected without running executable traps or printing secrets', async () => {
    let touched = 0
    const poisoned = ['--require-release']
    Object.defineProperty(poisoned, '0', {
      get() { touched++; throw new Error('FAKE_SECRET') }, enumerable: true,
    })
    for (const arg of [
      poisoned,
      new Proxy([], { get() { touched++; throw new Error('FAKE_SECRET') } }),
      Object.assign([], { extra: '--release' }),
      Object.setPrototypeOf([], null),
      ['--publish'],
      [Symbol('secret')],
    ]) {
      let output = ''
      await assert.rejects(main(arg, message => { output += message }),
        /Independent M3 consolidated readiness check refused/)
      assert.equal(output, '')
    }
    assert.equal(touched, 0)
  })

  it('operator command is independent of process cwd and leaves unrelated directories clean', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'supa-m3-consolidated-cwd-'))
    try {
      const child = run([], { cwd: temp })
      assert.equal(child.status, 0, child.stderr)
      verifyHold(JSON.parse(child.stdout))
      assert.deepEqual(await readdir(temp), [])
    } finally { await rm(temp, { recursive: true, force: true }) }
  })
})
