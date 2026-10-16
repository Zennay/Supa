/**
 * Daily supervisor for the existing polite multi-retailer engine.
 *
 * Cron/systemd executes this once a day. No source is enabled by default:
 * operator supplies a reviewed private per-source lawful-use policy.
 * PLUS/Deka additionally have a canonical project source gate.
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { reviewedRetailerIds } from './daily-source-policy.mjs'
import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

export function permittedDailyIds(policy,canonicalGate,now=new Date()){
  // Validate the ENTIRE canonical two-retailer registry first, even if the
  // independently scoped daily policy enables only one retailer (or none).
  // A first-match PLUS/Deka row alone cannot establish permission when its
  // sibling, version, review chronology or duplicate rows are invalid.
  evaluateSourcePermissionGate(canonicalGate)
  const ids=reviewedRetailerIds(policy,now)
  for(const id of ids){
    if(id!=='plus'&&id!=='dekamarkt')continue
    const row=canonicalGate?.sources?.find(s=>s.supermarket===id)
    if(!row||row.permissionStatus!=='permitted'||row.productionEnabled!==true||
       !row.evidence?.some(e=>e.kind==='written_permission'||e.kind==='official_license')){
      throw Error('Canonical PLUS/Deka project source gate blocks unattended scraper')
    }
  }
  return ids
}

export async function planDailyRefresh({policyPath,sourceGatePath,now=new Date()}) {
  if(!policyPath||!sourceGatePath)throw Error('Daily source policy and canonical gate paths required')
  const [policy,canonicalGate]=await Promise.all([
    readFile(policyPath,'utf8').then(JSON.parse),
    readFile(sourceGatePath,'utf8').then(JSON.parse),
  ])
  return permittedDailyIds(policy,canonicalGate,now)
}

export async function runDailyRefresh({
  policyPath,sourceGatePath,dbPath,scriptPath='scraper/cli.mjs',
  runner=null,now=new Date(),
}) {
  const ids=await planDailyRefresh({policyPath,sourceGatePath,now})
  if(ids.length===0)return {status:'disabled-no-reviewed-sources',
    fetched:0,sourceCount:0,productionEnabled:false}
  if(typeof dbPath!=='string'||!dbPath.trim())throw Error('Persistent SQLite path required')
  const argv=[scriptPath,'scrape','--retailer',ids.join(','),
    '--db',dbPath,'--skip-fresh','20']
  const execute=runner??((program,args)=>new Promise((resolve,reject)=>{
    const child=spawn(program,args,{stdio:'inherit',env:{...process.env}})
    child.once('error',reject)
    child.once('exit',(code,signal)=>code===0?resolve(0):reject(
      Error('Retailer daily refresh failed; check scraper log and do not claim fresh data')))
  }))
  await execute(process.execPath,argv)
  return {status:'attempted-review-required',
    sourceCount:ids.length,sourceIds:ids,publicPriceClaimsAllowed:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const policyPath=process.env.SUPA_SCRAPER_POLICY
  const sourceGatePath=process.env.SUPA_SOURCE_PERMISSION_GATE ||
    'evidence/m1/source-permission-gate.v1.json'
  const dbPath=process.env.SUPA_SCRAPER_DB
  if(!policyPath||!dbPath)throw Error('SUPA_SCRAPER_POLICY and SUPA_SCRAPER_DB required')
  runDailyRefresh({policyPath,sourceGatePath,dbPath})
    .then(status=>console.log(JSON.stringify(status)))
    .catch(()=>{console.error('Daily retailer collection refused or failed');process.exitCode=1})
}
