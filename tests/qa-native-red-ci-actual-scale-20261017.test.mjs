/**
 * Offline, wholly SYNTHETIC scale oracle resembling Node's actual nested
 * TAP geometry (root 3070, aggregate 3363, 67 failing cases).
 * It does not reproduce any original GitHub log or real retailer evidence.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE='qa-native-red-ci-actual-scale-20261017.test.mjs'
const OPTS={expectedRed:67,allowedTestFiles:[FILE]}
const timestamp='2026-10-17T05:55:00.00001Z '
const path='/home/runner/work/Supa/Supa/tests/'+FILE+':12:5'
function make({missingRoot=0,duplicateRoot=0,nestedPass=288,failSummary=67}={}) {
 const records=['TAP version 13']
 for(let i=1;i<=300;i++){
   if(i<=12){records.push('    not ok '+i+' - nested synthetic failure','      ---',
     "      location: '"+path+"'",'      ...')}
   else if(i<=12+nestedPass){records.push('    ok '+i+' - nested synthetic success')}
 }
 for(let i=1;i<=3070;i++){
   if(i===missingRoot)continue
   const index=i===duplicateRoot?i-1:i
   if(i<=55)records.push('not ok '+index+' - root synthetic failure','  ---',
       "  location: '"+path+"'",'  ...')
   else records.push('ok '+index+' - root synthetic success')
 }
 records.push('1..3070','# tests 3363','# pass 3296','# fail '+failSummary,
   '# skipped 0','# cancelled 0','# todo 0',
   '##[error]Process completed with exit code 1.')
 return records.map(x=>timestamp+x).join('\n')+'\n'
}
const analyze=spec=>analyzeNativeRedCi(make(spec),OPTS)
test('reference-scale: 3070 root, 300 nested, 67 failures and 3363 totals remain admissible',()=>{
 const x=analyze()
 assert.deepEqual([x.tests,x.pass,x.fail],[3363,3296,67])
 assert.equal(x.outcome,'expected-qa-red-only')
 assert.equal(x.byFile[FILE],67)
 assert.equal(x.productionReady,false)
})
test('reference-scale: incomplete native root cannot be hidden by nested cases',()=>{
 assert.throws(()=>analyze({missingRoot:3069}),/root|plan|TAP|evidence|number/i)
})
test('reference-scale: duplicate late root index cannot be hidden by nested cases',()=>{
 assert.throws(()=>analyze({duplicateRoot:3070}),/ordinal|duplicate|root|TAP/i)
})
test('reference-scale: one absent nested pass below summary is rejected',()=>{
 assert.throws(()=>analyze({nestedPass:280}),/absent|summary|TAP|proof|test/i)
})
test('reference-scale: all 67 failures must match a truthful aggregate',()=>{
 assert.throws(()=>analyze({failSummary:66}),/fail|inconsistent|RED|TAP/i)
})
test('CLI accepts reference-scale synthetic evidence only as nonproduction RED',()=>{
 const cli=fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs',import.meta.url))
 const result=spawnSync(process.execPath,[cli,'--expected-red=67','--allow='+FILE],{
   input:make(),encoding:'utf8',timeout:30000,maxBuffer:3*1024*1024
 })
 assert.equal(result.error,undefined)
 assert.equal(result.status,0,result.stderr)
 const proof=JSON.parse(result.stdout)
 assert.equal(proof.tests,3363)
 assert.equal(proof.fail,67)
 assert.equal(proof.productionReady,false)
 assert.equal(proof.sourcePermissionGate,'not-proven-by-red-node')
 assert.equal(proof.productionBuild,'not-proven-by-red-node')
})
