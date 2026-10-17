/**
 * Independent native TAP visual/transport safety. SGR colors and CRLF are
 * legitimate, but destructive cursor/control codes can make the displayed
 * log differ from the events the offline parser certifies.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE='qa-native-red-ci-display-control-20261017.test.mjs'
const CFG={expectedRed:1,allowedTestFiles:[FILE]}
const stamp='2026-10-17T05:45:00.000123Z '
function makeJob({events,extra='',newline='\n'}={}){
  const rows=[
    'TAP version 13',
    ...(events??['not ok 1 - QA-owned synthetic fail','  ---',
      "  location: '/home/runner/work/Supa/Supa/tests/"+FILE+":12:5'",
      '  ...','ok 2 - root pass']),
    '1..2','# tests 2','# pass 1','# fail 1',
    '# skipped 0','# cancelled 0','# todo 0',
    '##[error]Process completed with exit code 1.',
    ...(extra?[extra]:[])
  ]
  return rows.map(r=>stamp+r).join(newline)+newline
}
const verify = s => analyzeNativeRedCi(s,CFG)
const refuse = s => assert.throws(()=>verify(s),/control|transport|ambiguous|invalid|unsafe|native|evidence/i)

test('control: normal native TAP stream remains accepted',()=>{
  assert.equal(verify(makeJob()).productionReady,false)
})
test('control: valid SGR colors and CRLF transport remain accepted',()=>{
  const job=makeJob({
    events:['\x1b[31mnot ok 1 - owned fail\x1b[0m','  ---',
      "  location: '/home/runner/work/Supa/Supa/tests/"+FILE+":12:5'",
      '  ...','\x1b[32mok 2 - pass\x1b[0m'],
    newline:'\r\n'
  })
  assert.equal(verify(job).fail,1)
})
test('security: terminal CSI erase after summaries cannot be ignored',()=>{
  refuse(makeJob({extra:'cleanup \x1b[2K erased display'}))
})
test('security: standalone carriage return cannot rewrite a log line',()=>{
  refuse(makeJob({extra:'notice\rforged visible overwrite'}))
})
test('security: NUL byte in purported job log is not harmless commentary',()=>{
  refuse(makeJob({extra:'cleanup\x00silence'}))
})
test('security: Unicode right-to-left override cannot spoof displayed log',()=>{
  refuse(makeJob({extra:'cleanup \u202Ehidden-warning'}))
})
test('security: backspace controls cannot rewrite displayed test evidence',()=>{
  refuse(makeJob({extra:'cleanup\x08rewritten'}))
})
test('CLI rejects non-SGR display controls without positive JSON',()=>{
  const cli=fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs',import.meta.url))
  const result=spawnSync(process.execPath,[cli,'--expected-red=1','--allow='+FILE],{
    input:makeJob({extra:'cleanup \x1b[2K erase terminal line'}),encoding:'utf8',timeout:15000
  })
  assert.equal(result.error,undefined)
  assert.equal(result.status,2)
  assert.equal(result.stdout,'')
  assert.match(result.stderr,/Unverified native CI evidence/)
})
