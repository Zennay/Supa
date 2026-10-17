import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'

// Independent synthetic QA on owner DRAFT #3777. Tests a *live OS process*
// suspended beyond a disk-based stale-lease threshold, not a real VPS.
// Never read/write any customer keys, retailer data or external filesystem.
const KEY='L'.repeat(43)
const ENTRY='supa:planner-preferences:v2'
const payload={ [ENTRY]:'{"private":"synthetic-for-fixture-only"}' }
const hash=createHash('sha256').update(KEY).digest('hex')

const liveLockHolder=String.raw`
import { mkdir, open } from 'node:fs/promises'
const [dir, lock] = process.argv.slice(1)
await mkdir(dir, { recursive:true, mode:0o700 })
const held=await open(lock,'wx',0o600)
process.stdout.write('LIVE_LOCK_HELD\n')
await new Promise(() => {})
`;

async function sandbox(t){
  const root=await mkdtemp(join(tmpdir(),'supa-qa-live-stale-lock-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  return join(root,'sync')
}

test('positive: without any competing lock an independent store writes one private revision',async t=>{
  const dir=await sandbox(t)
  const store=createFileSyncStore({dir})
  const first=await store.write(KEY,0,payload)
  assert.equal(first.conflict,false)
  assert.equal(first.record.revision,1)
  assert.deepEqual((await store.read(KEY)).entries,payload)
  assert.deepEqual(await readdir(dir),[hash+'.json'])
})

test('P1: a still-live physical lock-holder must not lose writer exclusion only because its mtime aged',async t=>{
  const dir=await sandbox(t)
  const lock=join(dir,hash+'.lock')
  const proc=spawn(process.execPath,[
    '--input-type=module','-e',liveLockHolder,dir,lock,
  ],{stdio:['ignore','pipe','pipe']})
  let output=''
  let errors=''
  const ready=new Promise((resolve,reject)=>{
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data',chunk=>{
      output+=chunk
      if(output.includes('LIVE_LOCK_HELD\n'))resolve()
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data',chunk=>{errors+=chunk})
    proc.on('error',reject)
    proc.on('exit',(code,signal)=>reject(new Error('lock holder exited before ready '+code+'/'+signal+' '+errors)))
  })
  const timeout=setTimeout(()=>proc.kill('SIGKILL'),12_000)
  t.after(()=>{clearTimeout(timeout);if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL')})
  try{
    await ready
    assert.equal(proc.exitCode,null,'physical holder process remains alive')
    const initial=await stat(lock)
    assert.equal(initial.isFile(),true)
    // Simulates a process that was paused/suspended while still owning its
    // lock for longer than the 15s mtime threshold. It does NOT crash.
    const old=new Date(Date.now()-60_000)
    await utimes(lock,old,old)
    assert.ok(Date.now()-(await stat(lock)).mtimeMs>30_000)
    assert.equal(proc.exitCode,null,'the lock owner is still alive when timestamp ages')

    const store=createFileSyncStore({dir})
    let accepted=null
    let denied=null
    try { accepted=await store.write(KEY,0,payload) }
    catch(error) { denied=error }
    assert.equal(accepted,null,
      'active physical writer must not be fenced out merely by age; never ACK a second writer while its lock-holder is still live')
    assert.ok(denied,'new writer should fail closed or wait for genuine owner release')
    assert.equal((await store.read(KEY)).revision,0,
      'second writer must not publish a record while live holder retains writer exclusion')
    assert.deepEqual(await readdir(dir),[hash+'.lock'],
      'live holder lock must not be stolen or replaced')
  } finally {
    proc.kill('SIGKILL')
    await once(proc,'exit').catch(()=>{})
  }
})
