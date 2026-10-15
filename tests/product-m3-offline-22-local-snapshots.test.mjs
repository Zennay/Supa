import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile, chmod, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { canonicalM3RetailerRequirements } from '../scripts/retailer-canonical-m3-demand.mjs'
import {
  compareOfflineM3RetailerBasket, validateOfflineM3SnapshotManifest,
} from '../scripts/retailer-m3-offline-22-snapshots.mjs'

const NOW = Date.parse('2026-10-15T10:00:00Z')
const requirements = canonicalM3RetailerRequirements()
const SCRIPT = fileURLToPath(
  new URL('../scripts/retailer-m3-offline-22-snapshots.mjs', import.meta.url))

function html(item, index, price, availability='https://schema.org/InStock') {
  return '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product',
    sku: 'synthetic-' + index,
    name: item.query,
    weight: { value: item.unit === 'piece' ? '1 st' : '1000 ' + item.unit },
    offers: { '@type': 'Offer', price, priceCurrency: 'EUR', availability },
  }) + '</script>'
}

async function createPrivateCollection() {
  const folder = await mkdtemp(join(tmpdir(), 'supa-m3-22-local-'))
  await chmod(folder, 0o700)
  const products = [], snapshots = []
  for (const [shop, prefix] of [['plus','plus'], ['dekamarkt','deka']]) {
    for (let i=0; i<requirements.length; i++) {
      const item = requirements[i]
      const url = shop === 'plus'
        ? 'https://www.plus.nl/product/offline-synthetic-' + i
        : 'https://www.dekamarkt.nl/producten/offline-synthetic-' + i
      const htmlFile = prefix + '-' + i + '.html'
      const value = shop === 'plus' ? '1.50' : '1.25'
      products.push({ supermarket: shop, ingredientId: item.id, url })
      snapshots.push({
        supermarket: shop, url, htmlFile, capturedAt: '2026-10-15T09:00:00Z',
      })
      await writeFile(join(folder, htmlFile), html(item, i, value), {mode:0o600})
    }
  }
  const manifestPath = join(folder, 'private-manifest.json')
  const manifest = { version:1, products, snapshots }
  await writeFile(manifestPath, JSON.stringify(manifest), {mode:0o600})
  return { folder, manifestPath, manifest }
}

test('local authorized-file mode compares 22 complete synthetic product HTML files without networking', async t=>{
  const {folder,manifestPath,manifest} = await createPrivateCollection()
  t.after(()=>rm(folder,{recursive:true,force:true}))
  assert.equal(validateOfflineM3SnapshotManifest(manifest).captures.length,22)
  const result = await compareOfflineM3RetailerBasket(manifestPath,NOW)
  assert.equal(result.captureSummary.length,22)
  assert.ok(result.captureSummary.every(s=>s.parsedProducts===1))
  assert.equal(result.comparison.lines.length,11)
  assert.equal(result.comparison.comparable,true)
  assert.equal(result.comparison.cheaperStore,'dekamarkt')
  assert.ok(result.comparison.savingsCents>0)
  assert.equal(result.claimable,false)
  assert.equal(result.sourceRightsAsserted,false)
  assert.equal(result.provenance,'operator-supplied-offline-html-preview')
  const original=await readFile(manifestPath)
  assert.deepEqual(original, Buffer.from(JSON.stringify(manifest)))
})

test('offline refuses incomplete/duplicate products before any HTML is used', async t=>{
  const {folder,manifestPath,manifest}=await createPrivateCollection()
  t.after(()=>rm(folder,{recursive:true,force:true}))
  manifest.snapshots.pop()
  await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600})
  await assert.rejects(compareOfflineM3RetailerBasket(manifestPath,NOW),/one snapshot/)
  manifest.snapshots.push({...manifest.snapshots[0],htmlFile:'different.html'})
  await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600})
  await assert.rejects(compareOfflineM3RetailerBasket(manifestPath,NOW),/duplicate/)
})

test('offline rejects public-readability, symlinks and altered private HTML files', async t=>{
  const {folder,manifestPath}=await createPrivateCollection()
  t.after(()=>rm(folder,{recursive:true,force:true}))
  await chmod(manifestPath,0o644)
  await assert.rejects(compareOfflineM3RetailerBasket(manifestPath,NOW),/private bounded/)
  await chmod(manifestPath,0o600)
  const file=join(folder,'plus-0.html')
  await chmod(file,0o644)
  await assert.rejects(compareOfflineM3RetailerBasket(manifestPath,NOW),/private bounded/)
  await chmod(file,0o600)
  await rm(file)
  await writeFile(join(folder,'actual.html'),html(requirements[0],0,'1.50'),{mode:0o600})
  await symlink('actual.html',file)
  await assert.rejects(compareOfflineM3RetailerBasket(manifestPath,NOW),/private bounded/)
})

test('offline invalid or future clocks cannot become savings evidence', async t=>{
  const {folder,manifestPath,manifest}=await createPrivateCollection()
  t.after(()=>rm(folder,{recursive:true,force:true}))
  manifest.snapshots[0].capturedAt='2026-10-15T09:00:00+14:01'
  await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600})
  await assert.rejects(compareOfflineM3RetailerBasket(manifestPath,NOW),/Invalid or duplicate/)
  manifest.snapshots[0].capturedAt='2099-10-15T09:00:00Z'
  await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600})
  const result=await compareOfflineM3RetailerBasket(manifestPath,NOW)
  assert.equal(result.comparison.comparable,false)
  assert.equal(result.comparison.savingsCents,null)
})

test('CLI invalid private JSON never echoes source path, content or hidden values', async t=>{
  const {folder,manifestPath}=await createPrivateCollection()
  t.after(()=>rm(folder,{recursive:true,force:true}))
  await writeFile(manifestPath,'{"test":"synthetic-person@invalid.example"}',{mode:0o600})
  const child=spawnSync(process.execPath,
    ['--experimental-strip-types',SCRIPT,'--offline',manifestPath],{encoding:'utf8'})
  assert.notEqual(child.status,0)
  assert.equal(child.stdout,'')
  assert.doesNotMatch(child.stderr,/synthetic-person|invalid\.example|supa-m3-22-local-/)
  assert.match(child.stderr,/Private M3 offline comparison refused/)
})


test('Dutch private 22-line human comparison uses trusted physical basket reporter', async t => {
  const { folder, manifestPath } = await createPrivateCollection()
  t.after(() => rm(folder, { recursive: true, force: true }))
  const child = spawnSync(process.execPath, [
    '--experimental-strip-types', SCRIPT, '--offline', manifestPath, '--text',
  ], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /SUPA · PRIVATE OFFLINE BOODSCHAPPENVERGELIJKING/)
  assert.match(child.stdout, /kippendij/i)
  assert.match(child.stdout, /DekaMarkt/)
  assert.match(child.stdout, /GEEN LIVE PRIJZEN/)
  assert.match(child.stdout, /Niet gebruiken als live winkeladvies of bewezen besparing/)
  assert.doesNotMatch(child.stdout, /supa-m3-22-local-|private-manifest\.json/)
})
