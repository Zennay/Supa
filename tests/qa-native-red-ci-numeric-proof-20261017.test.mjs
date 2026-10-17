/**
 * Pure offline, adversarial numeric integrity checks for exact native
 * GitHub test proof. Synthetic TAP only; never source or release evidence.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE = 'qa-native-red-ci-numeric-proof-20261017.test.mjs'
const opts = {expectedRed:1, allowedTestFiles:[FILE]}
const nativePath = '/home/runner/work/Supa/Supa/tests/' + FILE + ':17:3'
const stamp = '2026-10-17T06:05:18.1234567Z '
function log({tests='2',pass='1',ok=1,fail='1',plan=tests}={}) {
  const lines=[
    'TAP version 13',
    'not ok 1 - synthetic failure',
    '  ---',
    "  location: '" + nativePath + "'",
    '  failureType: testCodeFailure',
    '  ...',
    ...Array.from({length:ok},(_,i)=>'ok '+(i+2)+' - synthetic success '+i),
    '1..'+plan,
    '# tests '+tests,'# pass '+pass, '# fail '+fail,
    '# skipped 0', '# cancelled 0', '# todo 0',
    '##[error]Process completed with exit code 1.',
  ]
  return lines.map(x=>stamp+x).join('\n')+'\n'
}
function refused(body) {
  assert.throws(()=>analyzeNativeRedCi(body,opts),
    /TAP|count|summary|number|invalid|unsafe|incomplete|proof|inconsistent|arith|bounded/i)
}
test('control: genuine two-event native TAP failure plus pass certifies only expected RED',()=>{
  const r=analyzeNativeRedCi(log(),opts)
  assert.deepEqual([r.tests,r.pass,r.fail],[2,1,1])
  assert.equal(r.productionReady,false)
})
test('control: one failed test and zero passes is a valid native failure summary',()=>{
  const r=analyzeNativeRedCi(log({tests:'1',pass:'0',ok:0}),opts)
  assert.deepEqual([r.tests,r.pass,r.fail],[1,0,1])
})
test('expected RED: rounding above Number.MAX_SAFE_INTEGER hides one actual failure',()=>{
  refused(log({tests:'9007199254740992',pass:'9007199254740992',ok:0}))
})
test('expected RED: overflowing decimal plan and pass counters become Infinity',()=>{
  const overflowing='9'.repeat(320)
  refused(log({tests:overflowing,pass:overflowing,ok:0}))
})
test('expected RED: safe but physically absent million passing records do not support summary',()=>{
  refused(log({tests:'1200000',pass:'1199999',ok:0}))
})
test('expected RED: small TAP summary claims two passing tests but only one actually appears',()=>{
  refused(log({tests:'3',pass:'2',ok:1}))
})
test('expected RED: a summary cannot claim success with missing valid passing tests',()=>{
  refused(log({tests:'2',pass:'1',ok:0}))
})
test('expected RED: single very large safe-integer number is not supported by tiny log',()=>{
  refused(log({tests:'9007199254740991',pass:'9007199254740990',ok:0}))
})
test('CLI must exit nonzero with empty stdout on infinite numeric proof',()=>{
  const script=fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs',import.meta.url))
  const z='9'.repeat(320)
  const p=spawnSync(process.execPath,[script,'--expected-red=1','--allow='+FILE],
    {input:log({tests:z,pass:z,ok:0}),encoding:'utf8',timeout:15000})
  assert.equal(p.error,undefined)
  assert.equal(p.status,2)
  assert.equal(p.stdout,'')
  assert.match(p.stderr,/Unverified native CI evidence/)
})
