/**
 * Offline QA-only proof: native top-level TAP indexes must match the single
 * root plan. Nested subtests have independent indexes and may restart.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE = 'qa-native-red-ci-root-ordinal-20261017.test.mjs'
const OPTS = {expectedRed: 1, allowedTestFiles: [FILE]}
const stamp = '2026-10-17T05:24:31.000111Z '
const loc = "  location: '/home/runner/work/Supa/Supa/tests/" + FILE + ":12:5'"
function build(top = ['not ok 1 - owned QA failure', 'ok 2 - good'], nested = []) {
  const records = []
  for (const row of top) {
    records.push(row)
    if (row.startsWith('not ok')) records.push('  ---', loc, '  ...')
  }
  const lines = ['TAP version 13', ...nested, ...records,
    '1..2', '# tests 2', '# pass 1', '# fail 1',
    '# skipped 0', '# cancelled 0', '# todo 0',
    '##[error]Process completed with exit code 1.']
  return lines.map(l=>stamp+l).join('\n')+'\n'
}
function refuse(body) {
  assert.throws(()=>analyzeNativeRedCi(body, OPTS), /TAP|plan|root|ordinal|sequence|index|number|evidence|invalid|missing/i)
}
test('control: sequential root 1..2 with owned failure and one success is classified RED only', () => {
  const r=analyzeNativeRedCi(build(),OPTS)
  assert.deepEqual([r.tests,r.pass,r.fail],[2,1,1])
  assert.equal(r.productionReady,false)
})
test('control: nested success index 1 does not conflict with root ordinal 1', () => {
  const r=analyzeNativeRedCi(build(undefined,['    ok 1 - nested replay']),OPTS)
  assert.equal(r.tests,2)
})
test('control: nested independent success 1/2 and parent root 1/2 stay valid', () => {
  const r=analyzeNativeRedCi(build(undefined,['    ok 1 - nested one','    ok 2 - nested two','    1..2']),OPTS)
  assert.equal(r.pass,1)
})
test('expected RED: duplicate top-level test ordinal 1 cannot stand in for ordinal 2', () => {
  refuse(build(['not ok 1 - owned QA failure','ok 1 - copied success']))
})
test('expected RED: root ordinal 9 cannot replace expected root ordinal 2', () => {
  refuse(build(['not ok 1 - owned QA failure','ok 9 - fabricated success']))
})
test('expected RED: root failure ordinal zero is invalid', () => {
  refuse(build(['not ok 0 - owned QA failure','ok 2 - good']))
})
test('expected RED: root failure ordinal 99 not part of 1..2 is invalid', () => {
  refuse(build(['not ok 99 - owned QA failure','ok 2 - good']))
})
test('compatibility: mixed root record ordering remains supported by prior verifier contract', () => {
  const r=analyzeNativeRedCi(build(['ok 2 - earlier pass','not ok 1 - owned QA failure']),OPTS)
  assert.equal(r.fail,1)
})
test('compatibility: nested pass may supplement root events in legacy aggregated evidence', () => {
  const r=analyzeNativeRedCi(build(['not ok 1 - owned QA failure'],['    ok 1 - nested pass']),OPTS)
  assert.equal(r.pass,1)
})
test('compatibility: nested owned failure may appear under a top-level pass', () => {
  const b=build(['ok 2 - success'], ['    not ok 1 - nested synthetic','      ---',
    '      location: \'/home/runner/work/Supa/Supa/tests/'+FILE+':12:5\'','      ...'])
  const r=analyzeNativeRedCi(b,OPTS)
  assert.equal(r.fail,1)
})
test('standalone CLI refuses duplicate top-level test indexes without affirmative JSON', () => {
  const script=fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs',import.meta.url))
  const p=spawnSync(process.execPath,[script,'--expected-red=1','--allow='+FILE],{
    input:build(['not ok 1 - owned QA failure','ok 1 - copied success']),
    encoding:'utf8',timeout:15000
  })
  assert.equal(p.error,undefined)
  assert.equal(p.status,2)
  assert.equal(p.stdout,'')
  assert.match(p.stderr,/Unverified native CI evidence/)
})
