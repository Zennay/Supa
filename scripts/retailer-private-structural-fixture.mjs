/** Private synthetic HTML topology from one verified source, never real retailer HTML. */
import { createHash } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { replayPrivateProductHtmlSnapshot, replayPrivateSelectorHtmlSnapshot } from './retailer-replay-private-html-product.mjs'
import { summarizeOfflineSelectorProposals } from './retailer-offline-selector-discovery.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'
const FIELD = new Set(['product','name','price','pack','offer','availability'])
const TAG = /^(article|section|div|span|p|li|h[1-6]|a)\.([a-z][a-z0-9_-]{0,58})$/i
const ATTRIBUTE = /^(article|section|div|span|p|li|h[1-6])\[(data-testid|itemprop)="([a-z][a-z0-9_-]{1,59})"\]$/i
const refuse = () => { throw Error('Private synthetic structural fixture refused') }
function elementFor(row) {
  if (!FIELD.has(row.field) || row.status !== 'needs-human-review' ||
      !Number.isSafeInteger(row.instances) || row.instances < 1) return null
  let match = TAG.exec(row.selector)
  if (match) return '<'+match[1].toLowerCase()+' class="'+match[2]+
    '" data-synthetic="true">SYNTHETIC STRUCTURE</'+match[1].toLowerCase()+'>'
  match = ATTRIBUTE.exec(row.selector)
  if (match) return '<'+match[1].toLowerCase()+' '+match[2]+'="'+match[3]+
    '" data-synthetic="true">SYNTHETIC STRUCTURE</'+match[1].toLowerCase()+'>'
  if (row.field === 'product' && /^a\[href\^="\/(?:product|producten)\/"\]$/.test(row.selector)) {
    const root = row.selector.includes('/producten/') ? '/producten/' : '/product/'
    return '<a href="'+root+'synthetic-only" data-synthetic="true">SYNTHETIC STRUCTURE</a>'
  }
  return null
}
async function writePrivate(path, bytes) {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.chmod(0o600)
    await handle.sync()
  } finally { await handle.close() }
}
export async function buildPrivateSyntheticHtmlFixture(htmlFile, newDirectory) {
  if (typeof htmlFile !== 'string' || typeof newDirectory !== 'string' ||
      !newDirectory.trim()) refuse()
  let snapshot, source
  try {
    const catalog = await replayPrivateSelectorHtmlSnapshot(htmlFile)
    snapshot = catalog.proposals
    source = catalog.source
  } catch {
    const product = await replayPrivateProductHtmlSnapshot(htmlFile)
    snapshot = product.selectorSnapshot
    source = {...product.source, kind:'product',
      sourceUrlSha256:product.source.productUrlSha256}
  }
  if (!snapshot || source.sha256 !== snapshot.source.sha256 ||
      snapshot.humanReviewRequired !== true || snapshot.readyForIngestion !== false)
    refuse()
  const safe = summarizeOfflineSelectorProposals(snapshot).selectors
  const htmlNodes = safe.map(elementFor).filter(Boolean).slice(0,24)
  if (htmlNodes.length === 0) refuse()
  const synthetic = '<!doctype html>\n<html lang="nl"><head><meta charset="utf-8">'+
    '<title>SYNTHETIC STRUCTURE - NOT RETAILER HTML</title></head><body>\n'+
    htmlNodes.join('\n')+'\n</body></html>\n'
  const out = resolve(newDirectory)
  await assertNoSymlinkedM3OutputParents(out)
  await mkdir(out,{mode:0o700})
  const manifest = {schemaVersion:1,kind:'synthetic-private-selector-fixture',
    source:{retailerId:source.retailerId,kind:source.kind,
      capturedAt:source.capturedAt,sha256:source.sha256,
      sourceUrlSha256:source.sourceUrlSha256},
    syntheticHtmlSha256:createHash('sha256').update(synthetic).digest('hex'),
    selectorsObserved:safe.length,syntheticNodes:htmlNodes.length,
    sourceTextRetained:false,sourcePricesRetained:false,originalHtmlRetained:false,
    humanReviewRequired:true,productionEnabled:false,published:false}
  await writePrivate(join(out,'synthetic-structure.html'),synthetic)
  await writePrivate(join(out,'provenance.json'),JSON.stringify(manifest,null,2)+'\n')
  return {created:true,htmlSha256:manifest.syntheticHtmlSha256,
    syntheticNodes:htmlNodes.length,productionEnabled:false,published:false}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==4) {console.error('Usage: <private-source.html> <new-private-folder>');process.exitCode=2}
  else buildPrivateSyntheticHtmlFixture(process.argv[2],process.argv[3])
    .then(x=>process.stdout.write(JSON.stringify(x)+'\n'))
    .catch(()=>{console.error('Private synthetic fixture creation refused');process.exitCode=2})
}
