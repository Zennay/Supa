import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../scripts/retailer-compare-local-snapshots.mjs'

const when = '2026-10-15T10:00:00Z'
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-atomic-report-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir,'plus.html'),'<html>Mock PLUS with no product prices</html>')
  await writeFile(join(dir,'deka.html'),'<html>Mock Deka with no product prices</html>')
  const manifest=join(dir,'manifest.json')
  await writeFile(manifest,JSON.stringify({version:1,
    requirements:[{id:'milk',query:'fictional milk',amount:1000,unit:'ml'}],
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'plus.html',capturedAt:when},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',capturedAt:when},
    ],
  }))
  return {dir,manifest,out:join(dir,'private.json')}
}

async function noTemps(dir) {
  const entries=await readdir(dir)
  assert.deepEqual(entries.filter(x=>x.startsWith('.supa-m3-')),[])
}

test('offline M3 report publishes fully formed JSON with private mode and no temporary files',async t=>{
  const {dir,manifest,out}=await fixture(t)
  await main([manifest,'--out',out])
  const report=JSON.parse(await readFile(out,'utf8'))
  assert.equal(report.format,'supa-local-snapshot-comparison-v1')
  assert.equal(report.comparison.claimable,false)
  assert.equal(report.comparison.savingsCents,null)
  assert.equal((await stat(out)).mode&0o777,0o600)
  await noTemps(dir)
})

test('offline M3 output never follows or overwrites an existing symlink',async t=>{
  const {dir,manifest,out}=await fixture(t)
  const existing=join(dir,'existing-owner-data.json')
  const sentinel='{\"private\":\"owner-data\"}\\n'
  await writeFile(existing,sentinel)
  await symlink(existing,out)
  await assert.rejects(main([manifest,'--out',out]),/EEXIST/)
  assert.equal(await readFile(existing,'utf8'),sentinel)
  await noTemps(dir)
})

test('offline M3 concurrent publication has one winner, never a partial report',async t=>{
  const {dir,manifest,out}=await fixture(t)
  const results=await Promise.allSettled(Array.from({length:4},()=>main([manifest,'--out',out])))
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
  for(const result of results.filter(x=>x.status==='rejected')) {
    assert.match(String(result.reason),/EEXIST/)
  }
  const content=await readFile(out,'utf8')
  const report=JSON.parse(content)
  assert.equal(report.comparison.claimable,false)
  assert.equal((await stat(out)).mode&0o777,0o600)
  await noTemps(dir)
})

test('offline M3 existing report is never truncated by a failed second write',async t=>{
  const {dir,manifest,out}=await fixture(t)
  const sentinel='{\"existing\":\"keep exact bytes\"}\\n'
  await writeFile(out,sentinel,{mode:0o600})
  await assert.rejects(main([manifest,'--out',out]),/EEXIST/)
  assert.equal(await readFile(out,'utf8'),sentinel)
  await noTemps(dir)
})
