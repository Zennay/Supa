import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp, writeFile, rm, chmod } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildM5ResearchPriorities, parsePriorityArgs,
  renderM5ResearchPrioritiesMarkdown,
} from '../scripts/m5-build-retailer-priorities.mjs'

const discovery = JSON.parse(await readFile(new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
const m1 = JSON.parse(await readFile(new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
const empty = () => ({version:1,purpose:'manual-research-only',reviews:[]})
const claim = (retailerId, changes={}) => ({
  retailerId, reviewedAt: '2026-10-13', sourceKind: 'unassessed',
  sourceUrl:null, termsUrl:null, robotsUrl:null,
  rightsState:'unknown', rightsEvidenceUrl:null,
  regionScope:'unknown', assortmentScope:'unknown',
  termsReview:'unreviewed', robotsReview:'unreviewed',
  ownerContactStatus:'unassessed', freshnessPlan:'unassessed',
  priority:'unprioritized', ...changes,
})

test('canonical 17-source priority queue begins with unresolved M1 rights, not invented sources', () => {
  const report=buildM5ResearchPriorities(structuredClone(discovery), structuredClone(m1), empty())
  assert.equal(report.total,17)
  assert.equal(report.reviewedCount,0)
  assert.equal(report.unreviewedCount,17)
  assert.equal(report.m1BlockedCount,2)
  assert.equal(report.currentPhase,'M3')
  assert.equal(report.productionReady,false)
  assert.equal(report.m5Eligible,false)
  assert.deepEqual(report.queue.slice(0,2).map(x=>x.retailerId),['plus','dekamarkt'])
  assert.deepEqual(report.queue.slice(0,2).map(x=>x.nextActionCode),
    ['resolve-m1-permission','resolve-m1-uncertainty'])
  assert.ok(report.queue.every(x=>!x.productionEnabled && !x.rightsVerified && x.requiresHuman))
  assert.deepEqual(report, buildM5ResearchPriorities(discovery,m1,empty()))
})

test('research priority follows evidence completeness, not automation permission', () => {
  const ledger=empty()
  ledger.reviews.push(claim('aldi', { sourceKind:'official-feed',
    sourceUrl:'https://example.invalid/feed', rightsState:'claimed-written-permission',
    rightsEvidenceUrl:'https://example.invalid/REDACTED-secret',
    termsReview:'allowance-claimed', robotsReview:'allowance-claimed',
    ownerContactStatus:'reply-recorded', priority:'P1' }))
  ledger.reviews.push(claim('boni',{rightsState:'denied'}))
  ledger.reviews.push(claim('boon',{ sourceKind:'official-api',
    sourceUrl:'https://example.invalid/api',
    termsReview:'unreviewed', robotsReview:'unreviewed' }))
  ledger.reviews.push(claim('ekoplaza',{sourceKind:'official-feed',
    sourceUrl:'https://example.invalid/feed',termsReview:'restrictive',
    robotsReview:'restrictive',ownerContactStatus:'owner-identified'}))
  ledger.reviews.push(claim('hoogvliet',{rightsState:'request-pending'}))
  const baseline=structuredClone(ledger)
  const report=buildM5ResearchPriorities(discovery,m1,ledger)
  assert.equal(report.reviewedCount,5)
  assert.equal(report.unreviewedCount,12)
  const byId=Object.fromEntries(report.queue.map(x=>[x.retailerId,x]))
  assert.equal(report.queue[0].retailerId,'aldi')
  assert.equal(byId.aldi.nextActionCode,'independent-license-review')
  assert.equal(byId.boni.nextActionCode,'do-not-ingest')
  assert.equal(byId.boon.nextActionCode,'check-terms-and-robots')
  assert.equal(byId.ekoplaza.nextActionCode,'request-authorization')
  assert.equal(byId.hoogvliet.nextActionCode,'await-human-reply')
  assert.equal(byId.aldi.rightsVerified,false)
  assert.ok(!JSON.stringify(report).includes('REDACTED-secret'))
  assert.deepEqual(ledger,baseline)
})

test('research preference sorts only within human-action tier, never bypasses rights blockers', () => {
  const ledger = empty()
  // All three candidate records share "check-terms-and-robots" urgency,
  // but the manually chosen P1/P2/P3 order must override retailer alphabetics.
  ledger.reviews.push(claim('aldi', {
    sourceKind: 'official-feed', sourceUrl: 'https://example.invalid/a',
    priority: 'P3',
  }))
  ledger.reviews.push(claim('boni', {
    sourceKind: 'official-feed', sourceUrl: 'https://example.invalid/b',
    priority: 'P1',
  }))
  ledger.reviews.push(claim('boon', {
    sourceKind: 'official-feed', sourceUrl: 'https://example.invalid/c',
    priority: 'P2',
  }))
  const report = buildM5ResearchPriorities(discovery, m1, ledger)
  assert.deepEqual(report.queue.slice(0, 2).map(row => row.retailerId),
    ['plus', 'dekamarkt'], 'M1 rights must outrank all P1 research')
  const sameTier = report.queue.filter(row => row.nextActionCode === 'check-terms-and-robots')
  assert.deepEqual(sameTier.map(row => row.retailerId), ['boni', 'boon', 'aldi'])
  assert.deepEqual(sameTier.map(row => row.reviewPriority), ['P1', 'P2', 'P3'])
  assert.ok(report.queue.every(row => !row.rightsVerified && !row.productionEnabled))
})

test('unknown and internally contradictory review metadata cannot enter priority queue',()=>{
  const rogue=empty()
  rogue.reviews.push(claim('plus',{rightsState:'permitted'}))
  assert.throws(()=>buildM5ResearchPriorities(discovery,m1,rogue))
  const forged=structuredClone(discovery)
  forged.productionEnabled=true
  assert.throws(()=>buildM5ResearchPriorities(forged,m1,empty()),/schema/)
  const disputed=structuredClone(m1)
  disputed.sources[0].permissionStatus='approved'
  assert.throws(()=>buildM5ResearchPriorities(discovery,disputed,empty()))
})

test('Markdown escapes no private source URLs and accurately labels every retailer',()=>{
  const ledger=empty()
  ledger.reviews.push(claim('picnic',{sourceKind:'public-html',
    sourceUrl:'https://example.invalid/secret?id=1',rightsState:'request-pending'}))
  const report=buildM5ResearchPriorities(discovery,m1,ledger)
  const md=renderM5ResearchPrioritiesMarkdown(report)
  assert.equal((md.match(/\| (?:unknown|not-in-m1|permission_required|unresolved) \|/g)||[]).length,17)
  assert.match(md,/Human research only/)
  assert.ok(!md.includes('example.invalid'))
  assert.ok(!md.includes('http'))
})

test('CLI emits output for public empty template and rejects malicious options safely',async()=>{
  const cli=new URL('../scripts/m5-build-retailer-priorities.mjs',import.meta.url)
  for(const format of ['json','markdown']){
    const run=spawnSync(process.execPath,[cli.pathname,'--format='+format],{encoding:'utf8',timeout:20000})
    assert.equal(run.status,0,run.stderr)
    assert.equal(run.stderr,'')
    if(format==='json'){
      const report=JSON.parse(run.stdout)
      assert.equal(report.total,17)
      assert.equal(report.m5Eligible,false)
    }else{
      assert.match(run.stdout,/Supa — offline retailer rights review queue/)
    }
  }
  assert.equal(parsePriorityArgs(['--format=json']).format,'json')
  for(const args of [['--write'],['--format=html'],['--format=csv'],['--format=json','--format=markdown'],['one.json','two.json']]){
    assert.throws(()=>parsePriorityArgs(args))
  }
})

test('CLI private review never exposes URL, private filename or modified source',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-m5-priority-'))
  try {
    const ledger=empty()
    ledger.reviews=[claim('jumbo',{rightsState:'claimed-written-permission',
      rightsEvidenceUrl:'https://example.invalid/secret-license'})]
    const filename=join(dir,'fictional-private-research.json')
    const bytes=JSON.stringify(ledger)
    await writeFile(filename,bytes,{mode:0o600})
    if(process.platform!=='win32')await chmod(filename,0o600)
    const cli=new URL('../scripts/m5-build-retailer-priorities.mjs',import.meta.url)
    const run=spawnSync(process.execPath,[cli.pathname,filename],{encoding:'utf8',timeout:20000})
    assert.equal(run.status,0,run.stderr)
    assert.equal(JSON.parse(run.stdout).queue[0].retailerId,'jumbo')
    assert.ok(!run.stdout.includes('example.invalid'))
    assert.ok(!run.stdout.includes(filename))
    assert.equal(await readFile(filename,'utf8'),bytes)
    const reject=spawnSync(process.execPath,[cli.pathname,filename,'--format=csv'],{encoding:'utf8'})
    assert.equal(reject.status,2)
    assert.ok(!reject.stderr.includes(filename))
    assert.equal(reject.stdout,'')
  }finally{await rm(dir,{force:true,recursive:true})}
})
