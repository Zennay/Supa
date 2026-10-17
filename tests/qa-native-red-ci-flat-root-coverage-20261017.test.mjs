/**
 * Independent QA-only synthetic native TAP oracle: a flat root plan cannot
 * borrow nested subtest events to fill absent root ordinals. No retailer data.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE='qa-native-red-ci-flat-root-coverage-20261017.test.mjs'
const OPTIONS={expectedRed:1,allowedTestFiles:[FILE]}
const stamp='2026-10-17T06:25:00.000001Z '
const source="  location: '/home/runner/work/Supa/Supa/tests/"+FILE+":12:5'"
const rootBad=['not ok 1 - fictional QA root failure','  ---',source,'  ...']
const nestedBad=['    not ok 1 - fictional QA nested failure','      ---',source,'      ...']
function job(rows,{plan=2,tests=2,pass=1,fail=1}={}){
 return [
  'TAP version 13',...rows,'1..'+plan,
  '# tests '+tests,'# pass '+pass,'# fail '+fail,
  '# skipped 0','# cancelled 0','# todo 0',
  '##[error]Process completed with exit code 1.'
 ].map(x=>stamp+x).join('\n')+'\n'
}
const assess=(rows,opts)=>analyzeNativeRedCi(job(rows,opts),OPTIONS)
test('control: complete native flat root 1,2 remains expected-RED only',()=>{
 const result=assess([...rootBad,'ok 2 - root pass'])
 assert.deepEqual([result.tests,result.pass,result.fail],[2,1,1])
 assert.equal(result.productionReady,false)
})
test('control: complete reversed native flat root 2,1 still accepted',()=>{
 assert.equal(assess(['ok 2 - root pass',...rootBad]).outcome,'expected-qa-red-only')
})
test('control: full root plan 2 can contain nested pass only when total is 3',()=>{
 const r=assess([...rootBad,'    ok 1 - nested pass','ok 2 - root pass'],
   {plan:2,tests:3,pass:2})
 assert.equal(r.fail,1)
 assert.equal(r.productionReady,false)
})
test('attack: flat plan 2 with only root 1 and nested success must not prove root 2',()=>{
 assert.throws(()=>assess([...rootBad,'    ok 1 - nested pass']),/TAP|root|plan|witness|evidence/i)
})
test('attack: flat plan 2 with only root 2 and nested failure must not prove root 1',()=>{
 assert.throws(()=>assess(['ok 2 - root pass',...nestedBad]),/TAP|root|plan|witness|evidence/i)
})
test('attack: an absent root record cannot be replaced by only nested successes',()=>{
 assert.throws(()=>assess([...rootBad,'    ok 2 - nested pass']),/TAP|root|plan|witness|evidence/i)
})
test('CLI cannot emit affirmative proof for an incomplete flat root plan',()=>{
 const cli=fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs',import.meta.url))
 const child=spawnSync(process.execPath,[cli,'--expected-red=1','--allow='+FILE],{
  input:job([...rootBad,'    ok 1 - nested pass']),
  encoding:'utf8',timeout:15000
 })
 assert.equal(child.error,undefined)
 assert.equal(child.status,2)
 assert.equal(child.stdout,'')
 assert.match(child.stderr,/Unverified native CI evidence/)
})
