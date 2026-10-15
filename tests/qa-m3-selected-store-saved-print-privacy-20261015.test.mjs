import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, stat, access, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  main, renderPrintablePrivateShoppingChecklist,
} from '../scripts/retailer-private-shopping-checklist-html.mjs'

// All values and labels are invented. No real store visit/price/participant,
// retailer network request, legal reuse permission or public savings evidence.
function imaginaryReport() {
  const line = (id, label, cents) => ({
    status: 'matched', productId: id, productName: label, packs: 1,
    packPriceCents: cents, totalCents: cents,
  })
  return {
    format: 'supa-local-snapshot-comparison-v1',
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      stores: {
        plus: {complete: true, subtotalCents: 129},
        dekamarkt: {complete: true, subtotalCents: 991},
      },
      lines: [{
        ingredientId: 'fictional-milk', ingredient: 'fictieve melk',
        plus: line('p-only', 'PLUS-PRIVATE-LABEL-NOT-DEKA', 129),
        dekamarkt: line('d-only', 'DEKA-PRIVATE-LABEL-NOT-PLUS', 991),
      }],
    },
  }
}
async function temporary(t) {
  const dir=await mkdtemp(join(tmpdir(), 'supa-single-shop-qa-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  return dir
}
test('PLUS-only private rendered HTML excludes other retailer purchase, totals and controls',()=>{
  const data=imaginaryReport()
  const both=renderPrintablePrivateShoppingChecklist(data)
  const only=renderPrintablePrivateShoppingChecklist(data, 'plus')
  assert.match(both,/PLUS-PRIVATE-LABEL-NOT-DEKA/)
  assert.match(both,/DEKA-PRIVATE-LABEL-NOT-PLUS/)
  assert.match(only,/<h2>PLUS<\/h2>/)
  assert.match(only,/ALLEEN OFFLINE TOTAAL PLUS: €1,29/)
  assert.doesNotMatch(only,/DEKA-PRIVATE-LABEL-NOT-PLUS|€9,91|<h2>DekaMarkt<\/h2>/)
  assert.doesNotMatch(only,/<fieldset class="store-filter"/)
  assert.match(only,/<main class="grid single-shop"/)
  assert.equal((only.match(/type="checkbox"/g)||[]).length,1)
  assert.match(only,/script-src &#39;none&#39;/)
})
test('DekaMarkt-only private rendered HTML excludes other retailer purchase and cents',()=>{
  const only=renderPrintablePrivateShoppingChecklist(imaginaryReport(), 'dekamarkt')
  assert.match(only,/<h2>DekaMarkt<\/h2>/)
  assert.match(only,/ALLEEN OFFLINE TOTAAL DekaMarkt: €9,91/)
  assert.doesNotMatch(only,/PLUS-PRIVATE-LABEL-NOT-DEKA|€1,29|<h2>PLUS<\/h2>/)
  assert.doesNotMatch(only,/<fieldset class="store-filter"/)
  assert.equal((only.match(/type="checkbox"/g)||[]).length,1)
})
test('saved report --store option publishes just one selected shop in private mode 0600',async t=>{
  const dir=await temporary(t)
  const source=join(dir,'stored-private.json')
  await writeFile(source,JSON.stringify(imaginaryReport()))
  const before=await readFile(source)
  for(const [shop,match,excluded] of [
    ['plus','PLUS-PRIVATE-LABEL-NOT-DEKA','DEKA-PRIVATE-LABEL-NOT-PLUS'],
    ['dekamarkt','DEKA-PRIVATE-LABEL-NOT-PLUS','PLUS-PRIVATE-LABEL-NOT-DEKA'],
  ]){
    const target=join(dir,'selected-'+shop+'.html')
    const returned=await main(['--report',source,'--output',target,'--store',shop])
    const saved=await readFile(target,'utf8')
    assert.equal(saved,returned)
    assert.ok(saved.includes(match))
    assert.ok(!saved.includes(excluded),shop+' must not leak hidden store details')
    assert.equal((await stat(target)).mode & 0o777,0o600)
  }
  assert.deepEqual(await readFile(source),before)
})
test('invalid store choice and malformed saved-report CLI never publish a file',async t=>{
  const dir=await temporary(t)
  const source=join(dir,'saved.json')
  await writeFile(source,JSON.stringify(imaginaryReport()))
  const target=join(dir,'not-created.html')
  for(const args of [
    ['--report',source,'--output',target,'--store','both'],
    ['--report',source,'--output',target,'--store','PLUS'],
    ['--report',source,'--output',target,'--store','unknown'],
    ['--report',source,'--output',target,'--store'],
    ['--report',source,'--output',target,'--store','plus','extra'],
  ]){
    await assert.rejects(()=>main(args),/Invalid private offline checklist HTML arguments/)
    await assert.rejects(access(target))
  }
})
test('saved report inside a symlinked directory is refused without publishing or spilling paths',async t=>{
  const dir=await temporary(t)
  const real=join(dir,'real')
  const alias=join(dir,'alias')
  await mkdir(real)
  const source=join(real,'secret-private-source.json')
  const output=join(dir,'not-created.html')
  await writeFile(source,JSON.stringify(imaginaryReport()))
  await symlink(real,alias,'dir')
  await assert.rejects(
    ()=>main(['--report',join(alias,'secret-private-source.json'),'--output',output,'--store','plus']),
    err=>{
      assert.equal(err.message,'Private offline comparison file could not be read')
      assert.doesNotMatch(String(err),/secret-private-source\.json|supa-single-shop-qa-/)
      return true
    },
  )
  await assert.rejects(access(output))
})
