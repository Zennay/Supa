import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import {
  buildObservationSheet, restoreObservationSheetDraft,
  observationSheetHasUserInput,
} from '../src/domain/m3ObservationSheet.ts'
import { observationDraftFileSizeAllowed } from '../src/features/observation/observationDraftImport.ts'

// Second independent expected-RED case for #2448. An older asynchronous
// File.text() must not silently override a later user-selected import.
// The actual ObservationView TSX event closures are transpiled, not copied.
const source=readFileSync(new URL('../src/features/observation/ObservationView.tsx',import.meta.url),'utf8')
const tree=ts.createSourceFile('ObservationView.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
function handler(name,deps){
  let expression
  function search(n){
    if(ts.isVariableDeclaration(n)&&n.name.getText(tree)===name)expression=n.initializer
    ts.forEachChild(n,search)
  }
  search(tree)
  assert.ok(expression&&ts.isArrowFunction(expression))
  const compiled=ts.transpileModule('const __real = '+expression.getText(tree)+';',{
    fileName:name+'.ts',
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
    reportDiagnostics:true,
  })
  assert.deepEqual(compiled.diagnostics,[])
  return new Function(...deps,compiled.outputText+'\nreturn __real')
}
const actualApply=handler('applyImportedDraft',[
  'draftRecoveryNeeded','setImportStatus','setSheet','setPendingImport',
])
const actualImport=handler('importDraft',[
  'observationDraftFileSizeAllowed','setPendingImport','setImportStatus',
  'restoreObservationSheetDraft','observationSheetHasUserInput','sheet',
  'applyImportedDraft',
])
function fictionalDraft(name){
  const sheet=buildObservationSheet()
  sheet.study.studyId='fictional-'+name
  sheet.study.participantKey='qa-anon-only'
  sheet.baseline.lines[0].observedProduct.available=false
  return sheet
}
function deferredFile(sheet){
  const bytes=JSON.stringify(sheet)
  let finish
  return {
    size:Buffer.byteLength(bytes),
    text:()=>new Promise(resolve=>{finish=()=>resolve(bytes)}),
    finish:()=>{assert.ok(finish);finish()},
  }
}
test('EXPECTED RED: older slow import cannot silently replace newer selected draft',async()=>{
  const state={sheet:buildObservationSheet(),pending:null,status:null,events:[]}
  function setSheet(value){state.events.push('sheet:'+value.study.studyId);state.sheet=value}
  function setPendingImport(value){state.pending=value}
  function setImportStatus(value){state.status=value}
  const apply=actualApply(false,setImportStatus,setSheet,setPendingImport)
  const capturedBlankSheet=state.sheet
  const importDraft=actualImport(observationDraftFileSizeAllowed,setPendingImport,
    setImportStatus,restoreObservationSheetDraft,observationSheetHasUserInput,
    capturedBlankSheet,apply)
  const older=fictionalDraft('first-request')
  const newer=fictionalDraft('second-request')
  const olderFile=deferredFile(older)
  const newerFile=deferredFile(newer)
  const oldWork=importDraft(olderFile)
  const newestWork=importDraft(newerFile)
  newerFile.finish()
  await newestWork
  assert.equal(state.sheet.study.studyId,'fictional-second-request')
  assert.equal(state.status.kind,'success')
  olderFile.finish()
  await oldWork
  assert.equal(state.sheet.study.studyId,'fictional-second-request',
    'late resolution of first import must not overwrite newer user-selected data')
  assert.notEqual(state.events.at(-1),'sheet:fictional-first-request',
    'superseded import must never report silently replacing newer draft')
})
