/**
 * Compare two *proposed*, offline-only CSS selector sets from SHA-bound HTML.
 * No selector is approved, loaded into a scraper, or published.
 * Output is an aggregate alert ONLY; never HTML, CSS names, source URLs,
 * product names, prices, hash values or reviewer identities.
 */
import { lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FIELDS=['product','name','price','pack','offer','availability']
const SIGNALS=['schemaOrgProduct','nextData','nuxtData','jsonLd']
const KEYS=['schemaVersion','mode','source','bytes','scannedTags','structuredSignals',
  'selectors','humanReviewRequired','readyForIngestion','permissionVerified',
  'productionEnabled','publicSavingsClaimEligible']
const record=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max
const fail=()=>{throw new Error('Private selector drift comparison refused')}
function canonical(report) {
  if(!record(report,KEYS)||
    report.schemaVersion!==1||report.mode!=='offline-selector-proposals-only'||
    report.humanReviewRequired!==true||report.readyForIngestion!==false||
    report.permissionVerified!==false||report.productionEnabled!==false||
    report.publicSavingsClaimEligible!==false||
    !record(report.source,['retailerId','sha256','capturedAt'])||
    !['plus','dekamarkt'].includes(report.source.retailerId)||
    typeof report.source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(report.source.sha256)||
    typeof report.source.capturedAt!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(report.source.capturedAt)||
    !Number.isFinite(Date.parse(report.source.capturedAt))||
    Date.parse(report.source.capturedAt)>Date.now()||
    !integer(report.bytes,2*1024*1024)||!integer(report.scannedTags,25000)||
    !record(report.structuredSignals,SIGNALS)||
    !SIGNALS.every(k=>typeof report.structuredSignals[k]==='boolean')||
    !Array.isArray(report.selectors)||report.selectors.length>24) fail()
  const out=new Map()
  for(let i=0;i<report.selectors.length;i++) {
    if(!Object.hasOwn(report.selectors,i))fail()
    const s=report.selectors[i]
    if(!record(s,['field','selector','instances','status'])||
      !FIELDS.includes(s.field)||s.status!=='needs-human-review'||
      typeof s.selector!=='string'||s.selector.length>200||
      !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*|\[(?:data-testid|itemprop)="[a-z][a-z0-9_-]*"\]|\[href\^="\/(?:product|producten)\/"\])$/i.test(s.selector)||
      !integer(s.instances,25000)||s.instances<1)fail()
    const id=JSON.stringify([s.field,s.selector])
    if(out.has(id))fail()
    out.set(id,{field:s.field,instances:s.instances})
  }
  return out
}
/** The outcome is NOT an approved or active selector configuration. */
export function compareOfflineSelectorProposals(before,after) {
  const a=canonical(before),b=canonical(after)
  if(before.source.retailerId!==after.source.retailerId||
    Date.parse(after.source.capturedAt)<Date.parse(before.source.capturedAt))fail()
  const sameHash=before.source.sha256===after.source.sha256
  if(sameHash && (before.bytes!==after.bytes||
    before.scannedTags!==after.scannedTags||
    SIGNALS.some(k=>before.structuredSignals[k]!==after.structuredSignals[k])||
    a.size!==b.size||[...a].some(([id,entry])=>b.get(id)?.instances!==entry.instances)))fail()
  const output={
    mode:'private-offline-selector-drift-alert',reviewRequired:true,
    productionEnabled:false,permissionVerified:false,automatedSelectorPromotion:false,
    publicSavingsClaimEligible:false,externalRequests:0,
    htmlBytesDiffer:!sameHash,
    newSelectorCandidates:0,missingSelectorCandidates:0,
    changedCandidateInstanceCounts:0,structuredSignalFlips:0,
    perField:Object.fromEntries(FIELDS.map(f=>[f,{new:0,missing:0,countChanged:0}])),
  }
  for(const [id,entry] of b){
    const original=a.get(id)
    if(!original){
      output.newSelectorCandidates++
      output.perField[entry.field].new++
    }else if(original.instances!==entry.instances){
      output.changedCandidateInstanceCounts++
      output.perField[entry.field].countChanged++
    }
  }
  for(const [id,entry] of a){
    if(!b.has(id)){output.missingSelectorCandidates++;output.perField[entry.field].missing++}
  }
  for(const k of SIGNALS){
    if(before.structuredSignals[k]!==after.structuredSignals[k])output.structuredSignalFlips++
  }
  return output
}
async function readPrivate(path){
  if(typeof path!=='string'||!path||path.startsWith('-')||path.length>500||
    !/^[a-z0-9][a-z0-9_.-]*\.json$/i.test(basename(path)))fail()
  const full=resolve(path)
  let cur=full
  while(true){
    const s=await lstat(cur)
    if(s.isSymbolicLink())fail()
    if(cur===full&&(!s.isFile()||(s.mode&0o077)||s.size>65536))fail()
    const parent=dirname(cur)
    if(parent===cur)break
    cur=parent
  }
  const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{
    const s=await handle.stat()
    if(!s.isFile()||(s.mode&0o077)||s.size>65536)fail()
    const json=await handle.readFile('utf8')
    if(Buffer.byteLength(json,'utf8')>65536)fail()
    return JSON.parse(json)
  }finally{await handle.close()}
}
export async function main(argv=process.argv.slice(2),write=x=>process.stdout.write(x)){
  if(!Array.isArray(argv)||argv.length!==4||
    argv[0]!=='--before'||argv[2]!=='--after'||resolve(argv[1])===resolve(argv[3]))fail()
  const report=compareOfflineSelectorProposals(await readPrivate(argv[1]),await readPrivate(argv[3]))
  write(JSON.stringify(report)+'\n')
  return report
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(()=>{console.error('Private selector drift comparison refused');process.exitCode=2})
}
