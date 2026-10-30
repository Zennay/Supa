/** Private synthetic HTML topology from one verified source, never real retailer HTML. */
import { createHash } from 'node:crypto'
import { open, lstat, mkdtemp, rename, rm, readdir } from 'node:fs/promises'
import { constants as fsFlags } from 'node:fs'
import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'
import { isPublicMerchantProductHrefSelector } from './retailer-public-product-href-selectors.mjs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { replayPrivateProductHtmlSnapshot, replayPrivateSelectorHtmlSnapshot } from './retailer-replay-private-html-product.mjs'
import { summarizeOfflineSelectorProposals, proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'
const FIELD = new Set(['product','name','price','pack','offer','availability'])
const MICRODATA_PRODUCT = /^(article|section|div|li|a)\[itemtype="(https?:\/\/schema\.org\/Product)"\]$/

const TAG = /^(article|section|div|span|p|li|h[1-6]|a|data|time)\.([a-z][a-z0-9_-]{0,58})$/i
const ATTRIBUTE = /^(article|section|div|span|p|li|h[1-6]|meta|link|data|time)\[(data-testid|itemprop)="([a-z][a-z0-9_-]{1,59})"\]$/i
const refuse = () => { throw Error('Private synthetic structural fixture refused') }
function elementFor(row, retailerId) {
  if (!FIELD.has(row.field) || row.status !== 'needs-human-review' ||
      !Number.isSafeInteger(row.instances) || row.instances < 1) return null
  let match = TAG.exec(row.selector)
  if (match) return '<'+match[1].toLowerCase()+' class="'+match[2]+
    '" data-synthetic="true">SYNTHETIC STRUCTURE</'+match[1].toLowerCase()+'>'
  match = ATTRIBUTE.exec(row.selector)
  if (match) {
    const tag = match[1].toLowerCase()
    const opening = '<'+tag+' '+match[2]+'="'+match[3]+'" data-synthetic="true">'
    // The source's original content=price or ID is never retained. Meta is
    // an HTML void element and must not receive a fake closing element.
    return ['meta','link'].includes(tag) ? opening : opening+'SYNTHETIC STRUCTURE</'+tag+'>'
  }
  match=MICRODATA_PRODUCT.exec(row.selector)
  if (row.field === 'product' && match)
    return '<'+match[1]+' itemscope itemtype="'+match[2]+
      '" data-synthetic="true">SYNTHETIC STRUCTURE</'+match[1]+'>'
  if (row.field === 'product' &&
      isPublicMerchantProductHrefSelector(retailerId, row.selector)) {
    const root = /^a\[href\^="([^"<>]+)"\]$/.exec(row.selector)?.[1]
    if (!root) return null
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
  const rendered = safe.map(row => ({row,
    markup:elementFor(row,source.retailerId)}))
    .filter(x=>x.markup!==null).slice(0,24)
  const htmlNodes = rendered.map(x=>x.markup)
  if (htmlNodes.length === 0) refuse()
  const synthetic = '<!doctype html>\n<html lang="nl"><head><meta charset="utf-8">'+
    '<title>SYNTHETIC STRUCTURE - NOT RETAILER HTML</title></head><body>\n'+
    htmlNodes.join('\n')+'\n</body></html>\n'
  // Reparse the generated page with the real offline selector engine.
  // Synthetic structure must actually reproduce each emitted selector; a
  // string-only fixture with attractive but unusable markup is not deliverable.
  const syntheticOrigin = {retailerId:source.retailerId,
    url:'https://www.'+source.retailerId+'.nl/producten',
    capturedAt:source.capturedAt}
  const replay = proposeOfflineRetailerSelectors({html:synthetic,origin:syntheticOrigin})
  const observed = new Set(replay.selectors.map(x=>x.field+'|'+x.selector))
  if (replay.readyForIngestion!==false ||
      rendered.some(({row})=>!observed.has(row.field+'|'+row.selector))) refuse()
  const manifest = {schemaVersion:1,kind:'synthetic-private-selector-fixture',
    source:{retailerId:source.retailerId,kind:source.kind,
      capturedAt:source.capturedAt,sha256:source.sha256,
      sourceUrlSha256:source.sourceUrlSha256},
    syntheticHtmlSha256:createHash('sha256').update(synthetic).digest('hex'),
    selectorsObserved:safe.length,syntheticNodes:htmlNodes.length,
    syntheticSelectorRoundtripVerified:true,
    sourceTextRetained:false,sourcePricesRetained:false,originalHtmlRetained:false,
    humanReviewRequired:true,productionEnabled:false,published:false}
  return {synthetic,manifest}
}
async function assertVacantPrivateOutput(out) {
  try {
    await lstat(out)
    throw Object.assign(new Error('EEXIST: private fixture destination exists'),{code:'EEXIST'})
  } catch(e) { if(e?.code!=='ENOENT') throw e }
}

export async function buildPrivateSyntheticHtmlFixture(htmlFile, newDirectory) {
  if (typeof newDirectory !== 'string' || !newDirectory.trim()) refuse()
  const {synthetic,manifest} = await derivePrivateSyntheticFixture(htmlFile)
  const out = resolve(newDirectory)
  await assertNoSymlinkedM3OutputParents(out)
  const parent = dirname(out)
  const parentBefore = await lstat(parent)
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) refuse()
  await assertVacantPrivateOutput(out)
  // An incomplete two-file output must never appear as the final fixture.
  // Stage both private files, verify all bytes and source lineage, then move
  // the complete private directory into place in one same-parent rename.
  const staged = await mkdtemp(join(parent,'.supa-synthetic-fixture-'))
  const stageInfo = await lstat(staged)
  let published = false
  try {
    await writePrivate(join(staged,'synthetic-structure.html'),synthetic)
    await writePrivate(join(staged,'provenance.json'),JSON.stringify(manifest,null,2)+'\n')
    await verifyPrivateSyntheticHtmlFixture(htmlFile,staged)
    const parentNow = await lstat(parent)
    if (parentNow.dev !== parentBefore.dev || parentNow.ino !== parentBefore.ino ||
        !parentNow.isDirectory()) refuse()
    await assertNoSymlinkedM3OutputParents(out)
    await assertVacantPrivateOutput(out)
    // Node lacks renameat2(RENAME_NOREPLACE), so this private-path check is
    // not a hostile shared-filesystem race guarantee.
    await rename(staged,out)
    published = true
  } finally {
    if (!published) {
      try {
        const now=await lstat(staged)
        if (now.isDirectory() && now.dev===stageInfo.dev && now.ino===stageInfo.ino)
          await rm(staged,{recursive:true,force:true})
      } catch { /* leave unknown replacement untouched */ }
    }
  }
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

// A verified synthetic-only export must not silently carry unrelated originals.
async function assertExactPrivateBundleEntries(directory, expected) {
  const entries = await readdir(directory)
  if (entries.length !== expected.length ||
      entries.some(name => !expected.includes(name))) refuse()
}
export async function verifyPrivateSyntheticHtmlFixture(htmlFile, directory) {
  if (typeof directory !== 'string' || !directory.trim()) refuse()
  const out = resolve(directory)
  await assertNoSymlinkedM3OutputParents(out)
  const info = await lstat(out)
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0) refuse()
  await assertExactPrivateBundleEntries(out,['synthetic-structure.html','provenance.json'])
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
function pairManifest(plus, deka, schemaVersion=2) {
  return {schemaVersion,kind:'synthetic-two-retailer-private-fixtures',
    sources:[plus,deka].map(m=>({
      retailerId:m.source.retailerId,kind:m.source.kind,
      capturedAt:m.source.capturedAt,sha256:m.source.sha256,
      ...(schemaVersion===2?{sourceUrlSha256:m.source.sourceUrlSha256}:{}),
      syntheticHtmlSha256:m.syntheticHtmlSha256,
    })),retailers:['plus','dekamarkt'],originalHtmlRetained:false,
    pricePublicationEnabled:false,humanReviewRequired:true,
    productionEnabled:false,published:false}
}

export async function verifyPrivateSyntheticFixturePair(plusFile,dekaFile,directory) {
  if(typeof directory!=='string'||!directory.trim()) refuse()
  const out=resolve(directory)
  await assertNoSymlinkedM3OutputParents(out)
  const dir=await lstat(out)
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0) refuse()
  await assertExactPrivateBundleEntries(out,['plus','dekamarkt','pair-provenance.json'])
  const p=(await derivePrivateSyntheticFixture(plusFile)).manifest
  const d=(await derivePrivateSyntheticFixture(dekaFile)).manifest
  if(p.source.retailerId!=='plus'||d.source.retailerId!=='dekamarkt') refuse()
  const sourceChecks=await Promise.all([
    verifyPrivateSyntheticHtmlFixture(plusFile,join(out,'plus')),
    verifyPrivateSyntheticHtmlFixture(dekaFile,join(out,'dekamarkt'))])
  if(sourceChecks.some(x=>x.verified!==true)) refuse()
  const data=await readPinnedSyntheticFile(join(out,'pair-provenance.json'),16384)
  let parsed
  try {parsed=parseUniqueKeyRetailerJson(new TextDecoder('utf-8',{fatal:true})
    .decode(data),16384)} catch {refuse()}
  if((parsed.schemaVersion!==1&&parsed.schemaVersion!==2)||
      JSON.stringify(parsed)!==JSON.stringify(pairManifest(p,d,parsed.schemaVersion))) refuse()
  return {verified:true,retailers:2,sourceUrlHashBound:parsed.schemaVersion===2,
    productionEnabled:false,published:false}
}

// Compare two fully verified private capture pairs without revealing retailer
// text, raw URLs, prices, product IDs or source HTML to the operator's stdout.
export async function comparePrivateSyntheticFixturePairs(
  olderPlus,olderDeka,olderDir,newerPlus,newerDeka,newerDir) {
  const [before,after] = await Promise.all([
    verifyPrivateSyntheticFixturePair(olderPlus,olderDeka,olderDir),
    verifyPrivateSyntheticFixturePair(newerPlus,newerDeka,newerDir)
  ])
  // Old bundles may predate URL hashes; new evidence must use version 2.
  if(!before.verified||!after.verified||!after.sourceUrlHashBound) refuse()
  const oldSources=await Promise.all([olderPlus,olderDeka]
    .map(derivePrivateSyntheticFixture))
  const newSources=await Promise.all([newerPlus,newerDeka]
    .map(derivePrivateSyntheticFixture))
  const retailers=oldSources.map((older,i)=>{
    const newer=newSources[i]
    if(older.manifest.source.retailerId!==newer.manifest.source.retailerId) refuse()
    const first=older.manifest.source, last=newer.manifest.source
    const previousTime=Date.parse(first.capturedAt)
    const latestTime=Date.parse(last.capturedAt)
    if(!Number.isFinite(previousTime)||!Number.isFinite(latestTime)) refuse()
    const laterCapture=latestTime>previousTime
    const sourceChanged=first.sourceUrlSha256!==last.sourceUrlSha256 ||
      first.kind!==last.kind
    const htmlChanged=first.sha256!==last.sha256
    const selectorDrift=older.manifest.syntheticHtmlSha256!==
      newer.manifest.syntheticHtmlSha256
    return {retailerId:first.retailerId,
      outcome:!laterCapture?'stale-capture':
        sourceChanged?'review-source-change':
        selectorDrift?'review-selector-drift':
        htmlChanged?'review-html-change':'unchanged-recapture',
      laterCapture,sourceChanged,htmlChanged,selectorDrift,
      humanReviewRequired:true}
  })
  return {verified:true,retailers,allCapturesAdvanced:retailers.every(x=>x.laterCapture),
    anySelectorDrift:retailers.some(x=>x.selectorDrift),
    productionEnabled:false,published:false,priceClaimsEligible:false}
}

export async function buildPrivateSyntheticFixturePair(plusFile,dekaFile,newDirectory) {
  if(typeof newDirectory!=='string'||!newDirectory.trim()) refuse()
  const plus=(await derivePrivateSyntheticFixture(plusFile)).manifest
  const deka=(await derivePrivateSyntheticFixture(dekaFile)).manifest
  if(plus.source.retailerId!=='plus'||deka.source.retailerId!=='dekamarkt')
    refuse()
  const out=resolve(newDirectory)
  await assertNoSymlinkedM3OutputParents(out)
  const parent=dirname(out)
  const pinnedParent=await lstat(parent)
  if(!pinnedParent.isDirectory()||pinnedParent.isSymbolicLink()) refuse()
  await assertVacantPrivateOutput(out)
  const staged=await mkdtemp(join(parent,'.supa-two-store-'))
  const identity=await lstat(staged)
  let published=false
  try {
    await buildPrivateSyntheticHtmlFixture(plusFile,join(staged,'plus'))
    await buildPrivateSyntheticHtmlFixture(dekaFile,join(staged,'dekamarkt'))
    await writePrivate(join(staged,'pair-provenance.json'),
      JSON.stringify(pairManifest(plus,deka),null,2)+'\n')
    await verifyPrivateSyntheticFixturePair(plusFile,dekaFile,staged)
    const parentNow=await lstat(parent)
    if(!parentNow.isDirectory()||parentNow.ino!==pinnedParent.ino||
        parentNow.dev!==pinnedParent.dev) refuse()
    await assertNoSymlinkedM3OutputParents(out)
    await assertVacantPrivateOutput(out)
    // Atomic visibility of both stores; no claim of hostile-race immunity.
    await rename(staged,out)
    published=true
  } finally {
    if(!published) {
      try {
        const now=await lstat(staged)
        if(now.isDirectory()&&now.ino===identity.ino&&now.dev===identity.dev)
          await rm(staged,{recursive:true,force:true})
      } catch { /* do not remove unrecognized replacements */ }
    }
  }
  return {created:true,retailers:2,productionEnabled:false,published:false}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2)
  const mode=args[0]
  let job
  if(mode==='--verify' && args.length===3)
    job=verifyPrivateSyntheticHtmlFixture(args[1],args[2])
  else if(mode==='--pair' && args.length===4)
    job=buildPrivateSyntheticFixturePair(args[1],args[2],args[3])
  else if(mode==='--verify-pair' && args.length===4)
    job=verifyPrivateSyntheticFixturePair(args[1],args[2],args[3])
  else if(mode==='--compare-pair' && args.length===7)
    job=comparePrivateSyntheticFixturePairs(...args.slice(1))
  else if(args.length===2 && !args[0].startsWith('--'))
    job=buildPrivateSyntheticHtmlFixture(args[0],args[1])
  else {
    console.error('Usage: <source.html> <new-dir> | --verify <source.html> <dir> | --pair <plus.html> <deka.html> <new-dir> | --verify-pair <plus.html> <deka.html> <dir> | --compare-pair <oldPlus.html> <oldDeka.html> <oldDir> <newPlus.html> <newDeka.html> <newDir>')
    process.exitCode=2
  }
  if(job) job.then(x=>process.stdout.write(JSON.stringify(x)+'\n'))
    .catch(()=>{console.error('Private synthetic fixture operation refused');process.exitCode=2})
}
