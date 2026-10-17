import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { auditNativeGreenJob } from '../scripts/qa-native-green-ci-proof.mjs'

const H = 'a'.repeat(40)
const B = 'b'.repeat(40)
const NAMES = [
  'Set up job',
  'Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'Run actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'Run npm ci', 'Run npm audit --audit-level=high',
  'Run npm test', 'Run npm run m1:matching-benchmark',
  'Run npm run m1:source-permission-gate', 'Run npm run build',
  'Post Run actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'Post Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'Complete job',
]
const stages = [
  '##[group]Run npm ci', 'found 0 vulnerabilities',
  '##[group]Run npm audit --audit-level=high', 'found 0 vulnerabilities',
  '##[group]Run npm test',
  'TAP version 13', 'ok 1 - synthetic green benchmark',
  'ok 2 - source rights hold', '1..2',
  '# tests 2', '# pass 2', '# fail 0',
  '# cancelled 0', '# skipped 0', '# todo 0',
  '##[group]Run npm run m1:matching-benchmark',
  'Historical matching benchmark passed',
  '##[group]Run npm run m1:source-permission-gate',
  '{',
  '  "milestone": "M1 Data Feasibility",',
  '  "expectedSources": ["dekamarkt", "plus"],',
  '  "productionReady": false,',
  '  "blockers": [',
  '    {',
  '      "supermarket": "plus",',
  '      "permissionStatus": "permission_required",',
  '      "productionEnabled": false',
  '    },',
  '    {',
  '      "supermarket": "dekamarkt",',
  '      "permissionStatus": "unresolved",',
  '      "productionEnabled": false',
  '    }',
  '  ]',
  '}',
  '##[group]Run npm run build',
  '✓ built in 1.23s',
]
const stamp = line => '2026-10-17T04:12:32.1234567Z ' + line
const checkout = 'HEAD is now at abcdef1 Merge ' + H + ' into ' + B
function evidence() {
  return {
    run: {
      id: 39002222222, event: 'pull_request', status: 'completed',
      conclusion: 'success', head_sha: H, run_attempt: 1,
      html_url: 'https://github.com/Zennay/Supa/actions/runs/39002222222',
    },
    job: {
      id: 117311111111, run_id: 39002222222, name: 'test-build',
      status: 'completed', conclusion: 'success',
      steps: NAMES.map(name => ({name, status: 'completed', conclusion: 'success'})),
    },
    log: [checkout, ...stages].map(stamp).join('\n') + '\n',
    expectedHead: H, expectedBase: B,
  }
}
function noProof(bad) {
  assert.throws(() => auditNativeGreenJob(bad),
    /Unverified Supa native GREEN job evidence/)
}

test('positive: exact fake native job identifies complete GREEN, preserves denial of source rights', () => {
  const p = auditNativeGreenJob(evidence())
  assert.deepEqual(p, {
    outcome: 'native-green-evidence-consistent-not-authenticated',
    headSha: H, baseSha: B, runId: 39002222222, jobId: 117311111111,
    tests: 2, passed: 2, failures: 0, skipped: 0, cancelled: 0,
    auditHigh: 'zero-reported-in-log',
    sourcePermissions: 'explicitly-denied-in-log',
    productionReady: false, publicSavingsClaimEligible: false,
    realStorePricesVerified: 0,
  })
  assert.doesNotMatch(JSON.stringify(p), /sourceUrl|capturedAt|observedProductName|person@example|storeLocation/)
})

test('reject mismatched PR head/base and inconsistent job or run identity', () => {
  for (const modify of [
    x => { x.run.head_sha = B },
    x => { x.expectedHead = B },
    x => { x.expectedBase = 'c'.repeat(40) },
    x => { x.job.run_id++ },
    x => { x.run.id = -1 },
    x => { x.run.run_attempt = 2 },
    x => { x.run.html_url = 'https://example.invalid/runs/39002222222' },
    x => { x.run.event = 'push' },
    x => { x.log = x.log.replace(checkout, 'HEAD is now at abcdef1 Merge ' + B + ' into ' + H) },
    x => { x.log = x.log.replace(checkout, '') },
  ]) {
    const x = evidence()
    modify(x)
    noProof(x)
  }
})

test('node GREEN alone is not proof of a fully completed successful native job', () => {
  for (const modify of [
    x => { x.run.status = 'in_progress' },
    x => { x.run.conclusion = 'failure' },
    x => { x.job.conclusion = 'cancelled' },
    x => { x.job.steps[5].conclusion = 'failure' },
    x => { x.job.steps[7].status = 'pending' },
    x => { x.job.steps = x.job.steps.filter(s => s.name !== 'Run npm run build') },
    x => { x.job.steps[5].name = 'Run npm run build' },
    x => { x.job.steps.push({name: 'Run npm publish', status:'completed', conclusion:'success'}) },
  ]) {
    const x = evidence()
    modify(x)
    noProof(x)
  }
})

test('refuse corrupt or incomplete TAP, even when job metadata claims success', () => {
  for (const [original, replacement] of [
    ['TAP version 13', 'fake version 13'],
    ['1..2', '1..3'],
    ['# tests 2', '# tests 3'],
    ['# pass 2', '# pass 1'],
    ['# fail 0', '# fail 1'],
    ['# skipped 0', '# skipped 1'],
    ['# cancelled 0', '# cancelled 1'],
    ['# todo 0', '# todo 1'],
  ]) {
    const x = evidence()
    x.log = x.log.replace(original, replacement)
    noProof(x)
  }
  for (const appended of [
    'not ok 3 - forged source test',
    '##[error]Process completed with exit code 0.',
    '# pass 2',
    'TAP version 13',
  ]) {
    const x = evidence()
    x.log += stamp(appended) + '\n'
    noProof(x)
  }
})

test('must not certify source rights or price publication from a green technical result', () => {
  for (const [original,replacement] of [
    ['"productionReady": false', '"productionReady": true'],
    ['"permissionStatus": "unresolved"', '"permissionStatus": "permitted"'],
    ['"permissionStatus": "permission_required"', '"permissionStatus": "permitted"'],
    ['"productionEnabled": false', '"productionEnabled": true'],
  ]) {
    const x = evidence()
    x.log = x.log.replace(original, replacement)
    noProof(x)
  }
  const missing = evidence()
  missing.log = missing.log.replace('"productionReady": false,', '')
  noProof(missing)
})

test('no audit, missing build signature and re-ordered gates are invalid', () => {
  for (const [a,b] of [
    ['found 0 vulnerabilities', 'found 1 vulnerability'],
    ['✓ built in 1.23s', 'build failed'],
    ['##[group]Run npm audit --audit-level=high', '##[group]Run npm audit'],
    ['##[group]Run npm run m1:matching-benchmark', '##[group]Run wrong-benchmark'],
  ]) {
    const x = evidence()
    x.log = x.log.replace(a,b)
    noProof(x)
  }
  const x = evidence()
  x.job.steps[4].name = 'Run npm test'
  noProof(x)
})

test('large, malformed programmatic logs cannot silently normalize Unicode', () => {
  const lone = evidence()
  lone.log += '\ud800'
  noProof(lone)
  const huge = evidence()
  huge.log += 'a'.repeat(16 * 1024 * 1024 + 1)
  noProof(huge)
})

test('black-box CLI accepts only bounded exact-head successful JSON; bad input prints no summary', () => {
  const script = fileURLToPath(new URL('../scripts/qa-native-green-ci-proof.mjs', import.meta.url))
  const args = [script, '--head=' + H, '--base=' + B]
  const run = raw => spawnSync(process.execPath, args, {
    input: raw, encoding: 'utf8', timeout: 15000, maxBuffer: 100_000,
  })
  const positive = run(JSON.stringify(evidence()))
  assert.equal(positive.status, 0, positive.stderr)
  assert.equal(JSON.parse(positive.stdout).productionReady, false)
  const untrusted = evidence()
  untrusted.run.conclusion = 'failure'
  const negative = run(JSON.stringify(untrusted))
  assert.equal(negative.status, 2)
  assert.equal(negative.stdout, '')
  assert.match(negative.stderr, /^Unverified Supa native GREEN job evidence\s*$/)
  const invalid = run(Buffer.concat([Buffer.from(JSON.stringify(evidence())), Buffer.from([0xff])]))
  assert.equal(invalid.status, 2)
  assert.equal(invalid.stdout, '')
  const wrongArg = spawnSync(process.execPath, [script, '--head=' + H, '--base=' + H], {
    input: JSON.stringify(evidence()), encoding:'utf8', timeout: 15000,
  })
  assert.equal(wrongArg.status, 2)
  assert.equal(wrongArg.stdout, '')
})

test('fail closed if a retailer has the right denial but belongs to the wrong source', () => {
  const x = evidence()
  x.log = x.log.replace('"supermarket": "dekamarkt"', '"supermarket": "plus"')
  noProof(x)
  const y = evidence()
  y.log = y.log.replace('"permissionStatus": "permission_required"',
    '"permissionStatus": "unresolved"')
  noProof(y)
})

test('free-floating gate words do not replace structured rights JSON', () => {
  const x = evidence()
  x.log = x.log.replace(stamp('{'), stamp('  "someOtherObject": true'))
  noProof(x)
  const y = evidence()
  y.log = y.log.replace(stamp('}'), stamp('  "sourceRights": true'))
  noProof(y)
})


test('GREEN proof rejects any additional executable workflow step even when metadata claims success', () => {
  for (const name of ['Run bash -c unreviewed-network-action',
    'Run npm publish', 'Run python3 unreviewed-script.py',
    'Run actions/cache@deadbeef']) {
    const x = evidence()
    x.job.steps.push({name, status:'completed', conclusion:'success'})
    x.log += stamp('##[group]' + name) + '\n'
    noProof(x)
  }
})

test('green metadata must retain immutable pinned checkout and Node setup actions', () => {
  for (const [original, replacement] of [
    ['Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      'Run actions/checkout@' + 'f'.repeat(40)],
    ['Run actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
      'Run actions/setup-node@' + 'f'.repeat(40)],
  ]) {
    const x = evidence()
    const step = x.job.steps.find(s => s.name === original)
    assert.ok(step)
    step.name = replacement
    noProof(x)
  }
})

test('checkout and Node toolchain steps cannot be reordered after tests', () => {
  for (const name of NAMES.slice(1, 3)) {
    const x = evidence()
    x.job.steps = x.job.steps.filter(s => s.name !== name)
    x.job.steps.splice(8, 0, {
      name, status:'completed', conclusion:'success',
    })
    noProof(x)
  }
})

test('standard pinned setup actions and expected npm steps stay accepted with no source-rights release', () => {
  const x = evidence()
  const report = auditNativeGreenJob(x)
  assert.equal(report.tests, 2)
  assert.equal(report.productionReady, false)
  assert.equal(report.realStorePricesVerified, 0)
})
