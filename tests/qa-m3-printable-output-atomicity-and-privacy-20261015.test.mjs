import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, link, symlink, stat, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  main,
  renderPrintablePrivateShoppingChecklist,
} from '../scripts/retailer-private-shopping-checklist-html.mjs'

// Purely fabricated local fixtures. No retailer HTTP, receipts, people or price evidence.
const htmlProduct = price => '<html><script type="application/ld+json">' + JSON.stringify({
  '@type':'Product',sku:'fictional-milk',name:'Fictieve halfvolle melk',
  weight:{value:'1000 ml'},offers:{'@type':'Offer',price,priceCurrency:'EUR',
    availability:'https://schema.org/InStock'},
}) + '</script></html>'

async function createOfflineManifest(dir, suffix, plusPrice) {
  const plusHtml = join(dir, 'plus-' + suffix + '.html')
  const dekaHtml = join(dir, 'deka-' + suffix + '.html')
  await writeFile(plusHtml, htmlProduct(plusPrice))
  await writeFile(dekaHtml, htmlProduct('1.19'))
  const manifest = join(dir, 'manifest-' + suffix + '.json')
  await writeFile(manifest, JSON.stringify({
    version:1,requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'plus-' + suffix + '.html',
        capturedAt:new Date().toISOString()},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka-' + suffix + '.html',
        capturedAt:new Date().toISOString()},
    ],
  }))
  return [manifest, plusHtml, dekaHtml]
}

test('two concurrent independent writers can publish only complete private HTML, never a mixed report', async t => {
  const dir = await mkdtemp(join(tmpdir(),'supa-qa-print-atomic-'))
  t.after(() => rm(dir,{recursive:true,force:true}))
  const filesA = await createOfflineManifest(dir, 'a', '1.29')
  const filesB = await createOfflineManifest(dir, 'b', '1.39')
  const originalInputs = await Promise.all(
    [...filesA,...filesB].map(file => readFile(file,'utf8')),
  )
  const output = join(dir,'private-report.html')
  const settled = await Promise.allSettled([
    main([filesA[0],'--output',output]),
    main([filesB[0],'--output',output]),
  ])
  const completed = settled.filter(x => x.status === 'fulfilled').map(x => x.value)
  assert.ok(completed.length >= 1, 'At least one of the valid local checklists must publish')
  const final = await readFile(output,'utf8')
  assert.ok(completed.includes(final), 'The final report must be one whole completed publication')
  assert.match(final, /<!doctype html>/i)
  assert.match(final, /GEEN LIVE PRIJS|Geen live prijzen/i)
  assert.match(final, /<h2>PLUS<\/h2>/)
  assert.match(final, /<h2>DekaMarkt<\/h2>/)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  const remaining = await readdir(dir)
  assert.ok(!remaining.some(name => name.includes('.m3-tmp')),
    'Concurrent writers must not leave private staging files after settling')
  assert.deepEqual(
    await Promise.all([...filesA,...filesB].map(file => readFile(file,'utf8'))),
    originalInputs,
    'Neither concurrent writer may mutate any input manifest or HTML source',
  )
})

test('replacing an existing hardlink output never writes into unrelated private source inode', async t => {
  const dir = await mkdtemp(join(tmpdir(),'supa-qa-print-hardlink-'))
  t.after(() => rm(dir,{recursive:true,force:true}))
  const [manifest] = await createOfflineManifest(dir,'c','1.29')
  const unrelated = join(dir,'protected-secret.txt')
  const output = join(dir,'printed-checklist.html')
  await writeFile(unrelated,'PRIVATE-SENTINEL-DO-NOT-CORRUPT')
  await link(unrelated,output)
  const before = await stat(unrelated)
  const result = await main([manifest,'--output',output])
  assert.equal(await readFile(unrelated,'utf8'),'PRIVATE-SENTINEL-DO-NOT-CORRUPT')
  assert.equal((await stat(unrelated)).ino,before.ino)
  assert.notEqual((await stat(output)).ino,before.ino,
    'Atomic publication must replace the output link, never truncate source inode')
  assert.equal(await readFile(output,'utf8'),result)
  assert.equal((await stat(output)).mode & 0o777,0o600)
})

test('symlinked output ancestor is rejected; no HTML escapes into linked directory', async t => {
  const dir = await mkdtemp(join(tmpdir(),'supa-qa-print-symlink-'))
  t.after(() => rm(dir,{recursive:true,force:true}))
  const [manifest] = await createOfflineManifest(dir,'d','1.29')
  const real = join(dir,'physical-dir')
  await mkdir(real)
  await symlink(real,join(dir,'alias-dir'),'dir')
  await assert.rejects(
    () => main([manifest,'--output',join(dir,'alias-dir','result.html')]),
    /refusing symlinked M3 output parent directory/,
  )
  assert.ok(!(await readdir(real)).includes('result.html'))
})

test('CSS, HTML and accessibility attributes cannot be injected by local product labels', () => {
  const poison = '</span><style>body{display:none}</style><img src=x onerror="boom()">&"'
  const row = cents => ({status:'matched',packs:1,packPriceCents:cents,
    totalCents:cents,productId:'synthetic-product',productName:poison})
  const report = {format:'supa-local-snapshot-comparison-v1',
    comparison:{provenance:'offline-snapshot-preview',claimable:false,
      stores:{plus:{complete:true,subtotalCents:129},
        dekamarkt:{complete:true,subtotalCents:119}},
      lines:[{ingredientId:'fictional-milk',ingredient:'melk',
        plus:row(129),dekamarkt:row(119)}]}}
  const printed = renderPrintablePrivateShoppingChecklist(report)
  assert.doesNotMatch(printed, /<img\s+src=x|<style>body\{display:none\}|onerror="boom\(\)"/)
  assert.match(printed, /&lt;\/span&gt;&lt;style&gt;/)
  assert.match(printed, /&amp;&quot;/)
  assert.equal((printed.match(/type="checkbox"/g)||[]).length,2)
  assert.match(printed, /script-src &#39;none&#39;/)
  assert.doesNotMatch(printed, /https:\/\/example\.invalid|PRIVATE-SENTINEL-DO-NOT-CORRUPT/)
})
