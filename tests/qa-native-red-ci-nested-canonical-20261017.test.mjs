/**
 * Independent QA-only ordinal-wire controls: nested TAP events restart their
 * numbering but must still use canonical positive, safe decimal IDs.
 * No external network or retailer data.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE = 'qa-native-red-ci-nested-canonical-20261017.test.mjs'
const CONFIG = {expectedRed:1,allowedTestFiles:[FILE]}
const stamp='2026-10-17T05:40:00.000001Z '
const loc="      location: '/home/runner/work/Supa/Supa/tests/"+FILE+":12:5'"
const rootFail=['not ok 1 - own fail','  ---',loc,'  ...']
const nestedFail=['    not ok 1 - own nested failure','      ---',loc,'      ...']
const failZero=['    not ok 0 - invalid nested ordinal','      ---',loc,'      ...']
function fixture(lines) {
  return ['TAP version 13',...lines,'1..2','# tests 2','# pass 1','# fail 1','# skipped 0','# cancelled 0','# todo 0','##[error]Process completed with exit code 1.']
    .map(line=>stamp+line).join('\n')+'\n'
}
function classify(lines){return analyzeNativeRedCi(fixture(lines),CONFIG)}
function reject(lines){assert.throws(()=>classify(lines),/TAP|ordinal|canonical|index|invalid|unsafe|test/i)}

test('control: nested positive index 1 is allowed to reuse root index 1',()=>{
  assert.equal(classify([...rootFail,'    ok 1 - valid nested pass']).productionReady,false)
})
test('control: nested owned failing index 1 may appear beside root passing index 2',()=>{
  assert.equal(classify([...nestedFail,'ok 2 - root parent']).fail,1)
})
test('control: ordinary root failure 1 and success 2 are accepted',()=>{
  assert.equal(classify([...rootFail,'ok 2 - root success']).tests,2)
})
test('attack: nested ok 0 cannot invent a passing TAP event',()=>{
  reject([...rootFail,'    ok 0 - invalid nested zero pass'])
})
test('attack: nested not ok 0 cannot become an allowlisted native failure',()=>{
  reject([...failZero,'ok 2 - root parent'])
})
test('attack: unsafe 2^53 nested passing ordinal cannot count as an observed pass',()=>{
  reject([...rootFail,'    ok 9007199254740992 - unsafe nested number'])
})
test('attack: zero-padded nested ordinal 01 cannot count as native canonical evidence',()=>{
  reject([...rootFail,'    ok 01 - noncanonical nested index'])
})
test('CLI: noncanonical nested ordinal must not emit affirmative JSON',()=>{
  const path=fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs',import.meta.url))
  const p=spawnSync(process.execPath,[path,'--expected-red=1','--allow='+FILE],{
    input:fixture([...rootFail,'    ok 0 - invalid nested zero pass']),encoding:'utf8',timeout:15000
  })
  assert.equal(p.error,undefined)
  assert.equal(p.status,2)
  assert.equal(p.stdout,'')
  assert.match(p.stderr,/Unverified native CI evidence/)
})
