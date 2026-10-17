/**
 * Independent QA: Node TAP root 1..N counts root records, but aggregate
 * # tests includes nested children. Synthetic log fixtures only.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE='qa-native-red-ci-nested-plan-20261017.test.mjs'
const OPTS={expectedRed:1,allowedTestFiles:[FILE]}
const stamp='2026-10-17T05:50:00.000011Z '
const origin="  location: '/home/runner/work/Supa/Supa/tests/"+FILE+":12:5'"
const bad=['not ok 1 - owned synthetic QA failure','  ---',origin,'  ...']
const ok=id=>'ok '+id+' - root synthetic pass'
const nested=id=>'    ok '+id+' - nested synthetic pass'
function log({records=[...bad,ok(2)],root=2,tests=2,pass=1,fail=1}={}) {
 const lines=['TAP version 13',...records,'1..'+root,
   '# tests '+tests,'# pass '+pass,'# fail '+fail,
   '# skipped 0','# cancelled 0','# todo 0',
   '##[error]Process completed with exit code 1.']
 return lines.map(s=>stamp+s).join('\n')+'\n'
}
const check=spec=>analyzeNativeRedCi(log(spec),OPTS)
const refuse=spec=>assert.throws(()=>check(spec),/TAP|plan|root|evidence|inconsistent|missing|number|invalid/i)

test('control: flat TAP plan and test totals match',()=>{
 assert.equal(check().productionReady,false)
})
test('control: reordered root records remain supported',()=>{
 assert.equal(check({records:[ok(2),...bad]}).fail,1)
})
test('control: nested results cannot invent missing top-level ordinal',()=>{
 refuse({records:[...bad,nested(1),nested(2)],root:2,tests:3,pass:2})
})
test('control: root index cannot exceed root plan even with nested totals',()=>{
 refuse({records:[...bad,ok(3),nested(1)],root:2,tests:3,pass:2})
})
test('valid native nesting: root plan two and aggregate three',()=>{
 const r=check({records:[nested(1),...bad,ok(2)],root:2,tests:3,pass:2})
 assert.deepEqual([r.tests,r.pass,r.fail],[3,2,1])
 assert.equal(r.productionReady,false)
})
test('valid native nesting: root plan three and aggregate five',()=>{
 const r=check({records:[nested(1),nested(2),...bad,ok(2),ok(3)],root:3,tests:5,pass:4})
 assert.deepEqual([r.tests,r.pass,r.fail],[5,4,1])
})
test('valid native nesting: reordered complete root with nested success',()=>{
 const r=check({records:[ok(2),nested(1),...bad],root:2,tests:3,pass:2})
 assert.equal(r.outcome,'expected-qa-red-only')
})
test('missing root records cannot satisfy an exaggerated root plan',()=>{
 refuse({records:[...bad,ok(2),nested(1)],root:4,tests:3,pass:2})
})
test('CLI proves complete native nested root and total without public claims',()=>{
 const script=fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs',import.meta.url))
 const p=spawnSync(process.execPath,[script,'--expected-red=1','--allow='+FILE],{
   input:log({records:[nested(1),...bad,ok(2)],root:2,tests:3,pass:2}),
   encoding:'utf8',timeout:15000
 })
 assert.equal(p.error,undefined)
 assert.equal(p.status,0,p.stderr)
 assert.equal(p.stderr,'')
 const proof=JSON.parse(p.stdout)
 assert.equal(proof.outcome,'expected-qa-red-only')
 assert.equal(proof.productionReady,false)
 assert.deepEqual([proof.tests,proof.pass,proof.fail],[3,2,1])
})
