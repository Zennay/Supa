import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat,
  symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'

// Independent QA only against frozen DRAFT owner #3777. This only uses
// disposable fixtures in OS tmpdir; it neither probes VPS file permissions
// nor touches real user/retailer records or follows actual external links.
const KEY = 'P'.repeat(43)
const PLAN = 'supa:planner-preferences:v2'
const entries = { [PLAN]: '{"fixture":"private-owner-only"}' }
const digest = createHash('sha256').update(KEY).digest('hex')
const recordName = digest + '.json'

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(),'supa-qa-sync-fileadmission-'))
  t.after(() => rm(root,{recursive:true,force:true}))
  return root
}

test('positive: a fresh private sync directory and single-link 0600 hashed record work normally', async t => {
  const root = await sandbox(t)
  const dir = join(root,'sync')
  const store = createFileSyncStore({ dir })
  const saved = await store.write(KEY,0,entries)
  assert.equal(saved.conflict,false)
  assert.equal(saved.record.revision,1)
  assert.deepEqual((await store.read(KEY)).entries,entries)
  assert.deepEqual(await readdir(dir),[recordName])
  assert.equal((await stat(dir)).mode & 0o077,0)
  assert.equal((await lstat(join(dir,recordName))).mode & 0o077,0)
  assert.ok(!(await readFile(join(dir,recordName),'utf8')).includes(KEY),'never write bearer secret')
})

for (const [label, mode] of [
  ['group-readable pre-existing directory',0o750],
  ['world-writable pre-existing directory',0o777],
]) {
  test('P2 sync: refuse or tighten '+label+' before saving private device metadata',async t=>{
    const root=await sandbox(t)
    const dir=join(root,'sync')
    await mkdir(dir,{mode:0o700})
    await chmod(dir,mode)
    assert.equal((await stat(dir)).mode & 0o777,mode)
    const store=createFileSyncStore({dir})
    let rejected=false
    try { await store.write(KEY,0,entries) } catch { rejected=true }
    const resulting=(await stat(dir)).mode & 0o077
    assert.ok(rejected || resulting===0,
      'private device filenames and lock/removal permissions must never be accepted in a pre-existing group/other-accessible storage directory')
    if (rejected) assert.deepEqual(await readdir(dir),[],'refusal must not persist private device data')
  })
}

test('P2 sync: configured sync directory symlink must never redirect records outside its configured root',async t=>{
  const root=await sandbox(t)
  const target=join(root,'other-location')
  await mkdir(target,{mode:0o700})
  const dir=join(root,'sync')
  await symlink(target,dir,'dir')
  assert.equal((await lstat(dir)).isSymbolicLink(),true)
  const store=createFileSyncStore({dir})
  await assert.rejects(
    () => store.write(KEY,0,entries),
    'a symlink leaf as the configured storage directory must be refused, not transparently followed')
  assert.deepEqual(await readdir(target),[],'a refused symlink must never create or alter files in the target')
})

test('P2 sync: a symlink record leaf must not import arbitrary external JSON as a private device snapshot',async t=>{
  const root=await sandbox(t)
  const dir=join(root,'sync')
  await mkdir(dir,{mode:0o700})
  const external=join(root,'fictional-other-record.json')
  await writeFile(external,JSON.stringify({
    revision:1,updatedAt:'2026-10-17T00:00:00.000Z',
    entries:{ [PLAN]:'{"fixture":"unrelated-external-file"}' },
  }),{mode:0o600})
  await symlink(external,join(dir,recordName),'file')
  const store=createFileSyncStore({dir})
  await assert.rejects(() => store.read(KEY),
    'an injected record symlink must not be followed to a different file without private per-device admission')
  assert.equal((await readFile(external,'utf8')).includes('unrelated-external-file'),true)
})

test('P2 sync: multi-linked record leaf must not import an alias to a different private file',async t=>{
  const root=await sandbox(t)
  const dir=join(root,'sync')
  await mkdir(dir,{mode:0o700})
  const external=join(root,'fictional-hardlinked-record.json')
  await writeFile(external,JSON.stringify({
    revision:1,updatedAt:'2026-10-17T00:00:00.000Z',
    entries:{ [PLAN]:'{"fixture":"aliased-other-owner"}' },
  }),{mode:0o600})
  await link(external,join(dir,recordName))
  assert.equal((await lstat(join(dir,recordName))).nlink,2)
  const store=createFileSyncStore({dir})
  await assert.rejects(() => store.read(KEY),
    'record hardlinks from other local files must be refused rather than accepted as independent private device state')
})
