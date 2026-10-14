import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

const CLI=fileURLToPath(new URL('../scripts/m5-compare-capture-signatures.mjs',import.meta.url))
const HTML='<!doctype html><html><body>fictional offline only</body></html>'
const SHA=createHash('sha256').update(HTML).digest('hex')
const MARKET='private-fictional-market'
const SOURCE='private-fictional-source'
const SOURCE_URL='https://example.invalid/secret-origin'
async function isolated(fn){
  const root=await mkdtemp(join(tmpdir(),'supa-private-direct-cli-'))
  try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}
}
function record(success=true,extra={}){
  return {id:SOURCE,supermarket:MARKET,kind:'product',success,
    requestedUrl:SOURCE_URL,capturedAt:'2026-10-14T00:00:00.000Z',
    ...(success?{sha256:SHA}:{}),...extra}
}
async function capture(root,name,rows,opts={}){
  const dir=join(root,name);await mkdir(dir)
  if(opts.html){
    await mkdir(join(dir,MARKET))
    for(const row of rows)if(row.success){
      await writeFile(join(dir,MARKET,row.id+'.html'),HTML)
    }
  }
  const manifest=join(dir,'manifest.json')
  const data=opts.raw??JSON.stringify({
    milestone:'M1 Data Feasibility',bounded:true,
    sourceCount:rows.length,results:rows
  })
  if(!opts.missing)await writeFile(manifest,data)
  return {dir,manifest,raw:data}
}
function exec(...dirs){
  const r=spawnSync(process.execPath,[CLI,...dirs],{
    encoding:'utf8',timeout:20000,maxBuffer:1024*1024
  })
  assert.equal(r.error,undefined)
  assert.equal(r.signal,null)
  return r
}
function privateFailure(r){
  assert.notEqual(r.status,0)
  assert.equal(r.stdout,'')
  assert.equal(r.stderr,'Offline comparison failed: invalid capture or report\n')
  assert.doesNotMatch(r.stdout+r.stderr,
    /private-fictional|example\.invalid|supa-private-direct-cli-|manifest\.json|\/proc\/self\/fd|node:internal|Error:|file:\/\//)
}
function manual(r,status){
  assert.equal(r.status,0,r.stderr)
  assert.equal(r.stderr,'')
  const report=JSON.parse(r.stdout)
  assert.equal(report.changes.length,1)
  assert.equal(report.changes[0].status,status)
  assert.equal(report.m5Eligible,false)
  assert.equal(report.productionReady,false)
}
test('independent direct CLI: missing current root never echoes absolute original pathname',async()=>{
  await isolated(async home=>privateFailure(exec(join(home,'PRIVATE-MISSING-ROOT'))))
})
test('independent direct CLI: missing manifest never echoes filename or local root',async()=>{
  await isolated(async home=>{
    const c=await capture(home,'current',[record(false)],{missing:true})
    privateFailure(exec(c.dir))
  })
})
test('independent direct CLI: malformed current JSON emits only one fixed stderr line',async()=>{
  await isolated(async home=>{
    const c=await capture(home,'current',[record(false)],{raw:'{"private-fictional\n'})
    privateFailure(exec(c.dir))
    assert.equal(await readFile(c.manifest,'utf8'),c.raw)
  })
})
test('independent direct CLI: malformed baseline does not leak prior/current private roots',async()=>{
  await isolated(async home=>{
    const now=await capture(home,'current',[record(false)])
    const past=await capture(home,'prior',[record(false)],{raw:'{"secret":"private-invalid" INVALID'})
    privateFailure(exec(now.dir,past.dir))
    assert.equal(await readFile(past.manifest,'utf8'),past.raw)
  })
})
test('independent direct CLI: missing historical manifest is private',async()=>{
  await isolated(async home=>{
    const now=await capture(home,'current',[record(false)])
    const past=await capture(home,'prior',[record(false)],{missing:true})
    privateFailure(exec(now.dir,past.dir))
  })
})
test('independent direct CLI: missing successful HTML path never appears in stderr',async()=>{
  await isolated(async home=>{
    const now=await capture(home,'current',[record(true)])
    privateFailure(exec(now.dir))
  })
})
test('independent direct CLI: SHA mismatch does not echo inspector details',async()=>{
  await isolated(async home=>{
    const now=await capture(home,'current',[record(true,{sha256:'0'.repeat(64)})],{html:true})
    privateFailure(exec(now.dir))
    assert.equal(await readFile(join(now.dir,MARKET,SOURCE+'.html'),'utf8'),HTML)
  })
})
test('independent direct CLI: nonhistorical same-date baseline refuses without leak',async()=>{
  await isolated(async home=>{
    const now=await capture(home,'current',[record(true)],{html:true})
    const prior=await capture(home,'prior',[record(true)],{html:true})
    privateFailure(exec(now.dir,prior.dir))
  })
})
test('independent direct CLI: bad flag argument never exposes usage trace',async()=>{
  privateFailure(exec('--private-sentinel'))
})
test('independent direct CLI: three arguments refuse with generic privacy',async()=>{
  privateFailure(exec('sensitive-A','sensitive-B','sensitive-C'))
})
test('independent direct CLI: unavailable synthetic P1 remains manual only',async()=>{
  await isolated(async home=>{
    const c=await capture(home,'current',[record(false)])
    manual(exec(c.dir),'unavailable')
  })
})
test('independent direct CLI: verified P2 without baseline remains manual only',async()=>{
  await isolated(async home=>{
    const c=await capture(home,'current',[record(true)],{html:true})
    manual(exec(c.dir),'baseline_missing')
  })
})
test('independent direct CLI: distinct earlier verified P3 remains manual only',async()=>{
  await isolated(async home=>{
    const now=await capture(home,'current',[record(true)],{html:true})
    const prior=await capture(home,'prior',[record(true,{
      capturedAt:'2026-10-13T00:00:00.000Z'
    })],{html:true})
    manual(exec(now.dir,prior.dir),'unchanged')
  })
})
test('independent API contract: exported comparator still returns trusted detailed error',async()=>{
  await isolated(async home=>{
    await assert.rejects(compareCaptureDirectories(join(home,'missing-original')),
      err=>err instanceof Error && err.message!=='Offline comparison failed: invalid capture or report')
  })
})
