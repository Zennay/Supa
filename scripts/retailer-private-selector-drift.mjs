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
import { types as nodeTypes } from 'node:util'

const FIELDS=['product','name','price','pack','offer','availability']
const SIGNALS=['schemaOrgProduct','nextData','nuxtData','jsonLd']
const KEYS=['schemaVersion','mode','source','bytes','scannedTags','structuredSignals',
  'selectors','humanReviewRequired','readyForIngestion','permissionVerified',
  'productionEnabled','publicSavingsClaimEligible']
const record=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max
const fail=()=>{throw new Error('Private selector drift comparison refused')}
// A stored selector proposal is an archive claim, not a fresh HTML capture.
// Date.parse normalizes impossible civil days: only exact physical UTC dates
// may participate in drift/change chronology or hash-linked source proof.
function physicalCaptureMilliseconds(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
  if (!match) return null
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || milliseconds > Date.now()) return null
  if (new Date(milliseconds).toISOString() !==
      match[1] + '.' + (match[2] ?? '').padEnd(3, '0') + 'Z') return null
  return milliseconds
}
function canonical(report) {
  if(!record(report,KEYS)||
    report.schemaVersion!==1||report.mode!=='offline-selector-proposals-only'||
    report.humanReviewRequired!==true||report.readyForIngestion!==false||
    report.permissionVerified!==false||report.productionEnabled!==false||
    report.publicSavingsClaimEligible!==false||
    !record(report.source,['retailerId','sha256','capturedAt'])||
    !['plus','dekamarkt'].includes(report.source.retailerId)||
    typeof report.source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(report.source.sha256)||
    physicalCaptureMilliseconds(report.source.capturedAt) === null||
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
// Programmatic direct comparisons are possible in addition to parsed private
// JSON. Never execute caller accessors/traps or trust prototype fields when
// reading a stored source identity, selector shape, or timestamp. Clone and
// pin all supported properties before performing any comparison.
function ownDataRecord(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      nodeTypes.isProxy(input)) fail()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) fail()
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.length !== fields.length ||
      keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
      fields.some(key => !Object.hasOwn(descriptors, key) ||
        !Object.hasOwn(descriptors[key], 'value'))) fail()
  return Object.freeze(Object.fromEntries(fields.map(key =>
    [key, descriptors[key].value])))
}
function ownSelectors(input) {
  if (nodeTypes.isProxy(input) || !Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Array.prototype || input.length > 24) fail()
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.length !== input.length + 1 ||
      !Object.hasOwn(descriptors, 'length') ||
      keys.some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) ||
          Number(key) >= input.length || !Object.hasOwn(descriptors[key], 'value')))) fail()
  return Object.freeze(Array.from({ length: input.length }, (_, i) => {
    const descriptor = descriptors[i]
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail()
    return ownDataRecord(descriptor.value, ['field','selector','instances','status'])
  }))
}
function pinnedProposal(input) {
  const report = ownDataRecord(input, KEYS)
  return Object.freeze({
    ...report,
    source: ownDataRecord(report.source, ['retailerId','sha256','capturedAt']),
    structuredSignals: ownDataRecord(report.structuredSignals, SIGNALS),
    selectors: ownSelectors(report.selectors),
  })
}

/** The outcome is NOT an approved or active selector configuration. */
export function compareOfflineSelectorProposals(before,after) {
  before=pinnedProposal(before)
  after=pinnedProposal(after)
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
// A SHA-bearing private JSON review must have one unambiguous parse:
// JSON.parse silently picks the last of duplicate object members. Inspect
// the original bounded bytes (including escaped spellings) before accepting
// any source clocks, identities, selector counts or permission flags.
function parseUniquePrivateJson(bytes) {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const scopes = []
    for (let i = 0; i < raw.length;) {
      const char = raw[i]
      if (char === '{' || char === '[') {
        if (scopes.length >= 128) fail()
        scopes.push(char === '{' ? new Set() : null)
        i++
        continue
      }
      if (char === '}' || char === ']') {
        if (!scopes.length) fail()
        scopes.pop()
        i++
        continue
      }
      if (char !== '"') { i++; continue }
      const start = i++
      while (i < raw.length) {
        if (raw[i] === '\\') { i += 2; continue }
        if (raw[i++] === '"') break
      }
      let next = i
      while (next < raw.length && (
        raw[next] === ' ' || raw.charCodeAt(next) === 9 ||
        raw.charCodeAt(next) === 10 || raw.charCodeAt(next) === 13)) next++
      const scope = scopes.at(-1)
      if (raw[next] === ':' && scope instanceof Set) {
        const name = JSON.parse(raw.slice(start, i))
        if (scope.has(name)) fail()
        scope.add(name)
      }
    }
    return JSON.parse(raw)
  } catch { fail() }
}
// A private archive is not a free-form path: pin its regular-file identity
// and enforce an owner-only immediate staging directory. A hardlink cannot
// impersonate a second historical capture under a different file name.
async function inspectPrivateArchivePath(full) {
  let cur = full
  let leaf
  for (;;) {
    const stat = await lstat(cur)
    if (stat.isSymbolicLink()) fail()
    if (cur === full) {
      if (!stat.isFile() || stat.nlink !== 1 ||
          (stat.mode & 0o077) || stat.size > 65536) fail()
      leaf = stat
    } else if (cur === dirname(full) &&
        (!stat.isDirectory() || (stat.mode & 0o077))) fail()
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return leaf
}
const sameArchive = (a,b) =>
  a.dev === b.dev && a.ino === b.ino && a.nlink === b.nlink &&
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs

async function readPrivate(path){
  if(typeof path!=='string'||!path||path.startsWith('-')||path.length>500||
    !/^[a-z0-9][a-z0-9_.-]*\.json$/i.test(basename(path)))fail()
  const full=resolve(path)
  const first=await inspectPrivateArchivePath(full)
  const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{
    const opened=await handle.stat()
    if (!opened.isFile() || opened.nlink !== 1 ||
        (opened.mode & 0o077) || opened.size > 65536 ||
        !sameArchive(first,opened)) fail()
    // Recheck the named source after taking the descriptor, including parent
    // privacy. Refuse if another writer exchanged the file at this path.
    if (!sameArchive(opened,await inspectPrivateArchivePath(full))) fail()
    const bytes=await handle.readFile()
    const after=await handle.stat()
    if(bytes.length>65536 || !sameArchive(opened,after) ||
        !sameArchive(after,await inspectPrivateArchivePath(full))) fail()
    return parseUniquePrivateJson(bytes)
  }finally{await handle.close()}
}
// Direct callers may invoke this private CLI function with an array containing
// getters, inherited indices or Proxy traps. Refuse before resolve/readPrivate.
function pinnedCliArgs(argv) {
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype || argv.length !== 4) fail()
  const descriptors = Object.getOwnPropertyDescriptors(argv)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.length !== 5 || !Object.hasOwn(descriptors, 'length') ||
      keys.some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^[0-3]$/.test(key) ||
          !Object.hasOwn(descriptors[key], 'value')))) fail()
  const values = Array.from({ length: 4 }, (_, i) => descriptors[i]?.value)
  if (values.some(value => typeof value !== 'string')) fail()
  return values
}
export async function main(argv=process.argv.slice(2),write=x=>process.stdout.write(x)){
  const args=pinnedCliArgs(argv)
  if(args[0]!=='--before'||args[2]!=='--after'||
    resolve(args[1])===resolve(args[3]))fail()
  const report=compareOfflineSelectorProposals(await readPrivate(args[1]),await readPrivate(args[3]))
  write(JSON.stringify(report)+'\n')
  return report
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(()=>{console.error('Private selector drift comparison refused');process.exitCode=2})
}
