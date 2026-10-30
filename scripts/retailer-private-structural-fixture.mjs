/** Private synthetic HTML topology from one verified source, never real retailer HTML. */
import { createHash } from 'node:crypto'
import { mkdir, open, lstat } from 'node:fs/promises'
import { constants as fsFlags } from 'node:fs'
import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'
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
async function derivePrivateSyntheticFixture(htmlFile) {
  if (typeof htmlFile !== 'string') refuse()
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
  const manifest = {schemaVersion:1,kind:'synthetic-private-selector-fixture',
    source:{retailerId:source.retailerId,kind:source.kind,
      capturedAt:source.capturedAt,sha256:source.sha256,
      sourceUrlSha256:source.sourceUrlSha256},
    syntheticHtmlSha256:createHash('sha256').update(synthetic).digest('hex'),
    selectorsObserved:safe.length,syntheticNodes:htmlNodes.length,
    sourceTextRetained:false,sourcePricesRetained:false,originalHtmlRetained:false,
    humanReviewRequired:true,productionEnabled:false,published:false}
  return {synthetic,manifest}
}
export async function buildPrivateSyntheticHtmlFixture(htmlFile, newDirectory) {
  if (typeof newDirectory !== 'string' || !newDirectory.trim()) refuse()
  const {synthetic,manifest} = await derivePrivateSyntheticFixture(htmlFile)
  const out = resolve(newDirectory)
  await assertNoSymlinkedM3OutputParents(out)
  await mkdir(out,{mode:0o700})
  await writePrivate(join(out,'synthetic-structure.html'),synthetic)
  await writePrivate(join(out,'provenance.json'),JSON.stringify(manifest,null,2)+'\n')
  return {created:true,htmlSha256:manifest.syntheticHtmlSha256,
    syntheticNodes:manifest.syntheticNodes,productionEnabled:false,published:false}
}
// Read the original output as a bounded, same-inode private file. Do not
// accept altered fixtures by recomputing only a self-declared manifest hash.
async function readPinnedSyntheticFile(path, maxBytes) {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size < 1 || before.size > maxBytes ||
      (before.mode & 0o077) !== 0) refuse()
  const handle = await open(path, fsFlags.O_RDONLY | fsFlags.O_NOFOLLOW |
    fsFlags.O_NONBLOCK)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      refuse()
    const bytes = await handle.readFile()
    const after = await handle.stat()
    const named = await lstat(path)
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 ||
        after.dev !== before.dev || after.ino !== before.ino ||
        named.dev !== before.dev || named.ino !== before.ino ||
        bytes.length !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      refuse()
    return bytes
  } finally { await handle.close() }
}

export async function verifyPrivateSyntheticHtmlFixture(htmlFile, directory) {
  if (typeof directory !== 'string' || !directory.trim()) refuse()
  const out = resolve(directory)
  await assertNoSymlinkedM3OutputParents(out)
  const info = await lstat(out)
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0) refuse()
  const {synthetic,manifest} = await derivePrivateSyntheticFixture(htmlFile)
  const htmlBytes = await readPinnedSyntheticFile(join(out,'synthetic-structure.html'),65536)
  const manifestBytes = await readPinnedSyntheticFile(join(out,'provenance.json'),16384)
  if (!htmlBytes.equals(Buffer.from(synthetic,'utf8'))) refuse()
  let actual
  try { actual = parseUniqueKeyRetailerJson(
    new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes),16384)
  } catch { refuse() }
  if (JSON.stringify(actual) !== JSON.stringify(manifest) ||
      createHash('sha256').update(htmlBytes).digest('hex') !== manifest.syntheticHtmlSha256)
    refuse()
  return {verified:true,syntheticNodes:manifest.syntheticNodes,
    htmlSha256:manifest.syntheticHtmlSha256,productionEnabled:false,published:false}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2)
  const verification=args.length===3 && args[0]==='--verify'
  if(!verification && args.length!==2) {
    console.error('Usage: <private-source.html> <new-private-folder> | --verify <private-source.html> <existing-private-folder>')
    process.exitCode=2
  } else {
    const job=verification
      ?verifyPrivateSyntheticHtmlFixture(args[1],args[2])
      :buildPrivateSyntheticHtmlFixture(args[0],args[1])
    job.then(x=>process.stdout.write(JSON.stringify(x)+'\n'))
      .catch(()=>{console.error('Private synthetic fixture operation refused');process.exitCode=2})
  }
}
