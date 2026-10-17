/** Independent offline native GREEN log-command parity oracle; no production claims. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { auditNativeGreenJob } from '../scripts/qa-native-green-ci-proof.mjs'

const HEAD = 'c'.repeat(40)
const BASE = 'd'.repeat(40)
const COMMANDS = [
  'Run npm ci',
  'Run npm audit --audit-level=high',
  'Run npm test',
  'Run npm run m1:matching-benchmark',
  'Run npm run m1:source-permission-gate',
  'Run npm run build',
]
const GROUP = command => '##[group]' + command
const stamp = line => '2026-10-17T04:23:55.1234567Z ' + line
const rights = [
  '{',
  '  "milestone": "M1 Data Feasibility",',
  '  "expectedSources": ["dekamarkt", "plus"],',
  '  "productionReady": false,',
  '  "blockers": [',
  '    {"supermarket":"plus","permissionStatus":"permission_required","productionEnabled":false},',
  '    {"supermarket":"dekamarkt","permissionStatus":"unresolved","productionEnabled":false}',
  '  ]',
  '}',
]
function sample() {
  const log = [
    'HEAD is now at abcdef1 Merge ' + HEAD + ' into ' + BASE,
    GROUP(COMMANDS[0]), 'found 0 vulnerabilities',
    GROUP(COMMANDS[1]), 'found 0 vulnerabilities',
    GROUP(COMMANDS[2]), 'TAP version 13',
    'ok 1 - test-only withheld field observation', '1..1',
    '# tests 1', '# pass 1', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0',
    GROUP(COMMANDS[3]), 'M1 benchmark passed',
    GROUP(COMMANDS[4]), ...rights,
    GROUP(COMMANDS[5]), '✓ built in 920ms',
  ]
  return {
    run: {
      id: 39000000001, event: 'pull_request', status: 'completed',
      conclusion: 'success', head_sha: HEAD, run_attempt: 1,
      html_url: 'https://github.com/Zennay/Supa/actions/runs/39000000001',
    },
    job: {
      id: 117000000001, run_id: 39000000001, name: 'test-build',
      status: 'completed', conclusion: 'success',
      steps: ['Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'Run actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        ...COMMANDS].map(name => ({name,status:'completed',conclusion:'success'})),
    },
    log: log.map(stamp).join('\n') + '\n',
    expectedHead: HEAD, expectedBase: BASE,
  }
}
const reject = candidate => assert.throws(
  () => auditNativeGreenJob(candidate),
  /Unverified Supa native GREEN job evidence/,
)

test('original six-step green job and denied store-rights report remains permitted as QA-only', () => {
  const result = auditNativeGreenJob(sample())
  assert.equal(result.tests, 1)
  assert.equal(result.productionReady, false)
  assert.equal(result.realStorePricesVerified, 0)
})

test('expected RED: unlisted npm publish command must invalidate an otherwise green native log', () => {
  const x = sample()
  x.log += stamp('##[group]Run npm publish --access public') + '\n'
  reject(x)
})

test('expected RED: unlisted arbitrary executable Run shell marker must invalidate green proof', () => {
  const x = sample()
  x.log = x.log.replace(stamp(GROUP(COMMANDS[5])),
    stamp('##[group]Run bash -c unauthorized-command') + '\n' +
    stamp(GROUP(COMMANDS[5])))
  reject(x)
})

test('expected RED: a second npm test command marker after a successful build is ambiguous', () => {
  const x = sample()
  x.log += stamp(GROUP(COMMANDS[2])) + '\n'
  reject(x)
})

test('valid setup-node and checkout action markers remain allowed if listed in the job steps', () => {
  const x = sample()
  const prefix = [
    'Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'Run actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  ]
  x.log = x.log.replace(stamp(GROUP(COMMANDS[0])),
    prefix.map(name => stamp(GROUP(name))).join('\n') + '\n' +
    stamp(GROUP(COMMANDS[0])))
  assert.equal(auditNativeGreenJob(x).productionReady, false)
})
