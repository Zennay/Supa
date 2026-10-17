import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'

// Independent add-only QA against newly updated DRAFT owner #3777
// a1f04b. Everything stays in one disposable temp root; "external" means
// another fictional local directory, NEVER the real host filesystem/VPS.
const KEY='V'.repeat(43)
const ENTRY='supa:planner-preferences:v2'
const entries={ [ENTRY]:'{"fixture":"never-a-retailer-observation"}' }
const digest=createHash('sha256').update(KEY).digest('hex')

async function sandbox(t){
  const root=await mkdtemp(join(tmpdir(),'supa-qa-sync-parent-alias-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  return root
}

test('positive: an owned direct 0700 directory with no symlink ancestors reads/writes normally',async t=>{
  const root=await sandbox(t)
  const store=createFileSyncStore({ dir:join(root,'sync') })
  const stored=await store.write(KEY,0,entries)
  assert.equal(stored.conflict,false)
  assert.equal(stored.record.revision,1)
  assert.deepEqual((await store.read(KEY)).entries,entries)
})

test('P2: a symbolic-link ancestor of the configured sync directory must not redirect newly written private records',async t=>{
  const root=await sandbox(t)
  const other=join(root,'fictional-other-tree')
  await mkdir(other,{mode:0o700})
  const alias=join(root,'alias')
  await symlink(other,alias,'dir')
  // The direct sync/ path does NOT exist before the write; recursive mkdir
  // must not follow alias/ while preparing the configured storage directory.
  const configured=join(alias,'sync')
  const store=createFileSyncStore({dir:configured})
  await assert.rejects(()=>store.write(KEY,0,entries),
    'even if the final directory leaf is a real dir, a symlink parent must not redirect a private device write')
  assert.deepEqual(await readdir(other),[],
    'private record and created sync directory must not appear under an unrelated local tree')
})

test('P2: a symbolic-link ancestor of an existing sync directory must not import external hashed device JSON',async t=>{
  const root=await sandbox(t)
  const other=join(root,'fictional-other-tree')
  const elsewhere=join(other,'sync')
  await mkdir(elsewhere,{recursive:true,mode:0o700})
  await writeFile(join(elsewhere,digest+'.json'),JSON.stringify({
    revision:1,updatedAt:'2026-10-17T00:00:00.000Z',
    entries:{ [ENTRY]:'{"fixture":"other-local-owner"}' },
  }),{mode:0o600})
  const alias=join(root,'alias')
  await symlink(other,alias,'dir')
  const store=createFileSyncStore({dir:join(alias,'sync')})
  await assert.rejects(()=>store.read(KEY),
    'lstat of final sync/ alone does not establish trust in its symlinked parent path')
})
