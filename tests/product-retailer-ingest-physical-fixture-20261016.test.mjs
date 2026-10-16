import assert from 'node:assert/strict'
import test from 'node:test'
import { link, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readBoundedRegularReviewedFixture, loadReviewedRepositoryFixtures,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Synthetic local files only: no real retailer capture or retail HTTP.
async function tempFile(fn) {
  const dir = await mkdtemp(join(tmpdir(),'supa-reviewed-fixture-identity-'))
  try {
    const file = join(dir,'reviewed.json')
    const value = {source:{retailer:'fictional',capture:'archived'},records:[1,2,3]}
    await writeFile(file,JSON.stringify(value),{mode:0o600})
    return await fn({dir,file,value})
  } finally {
    await rm(dir,{recursive:true,force:true})
  }
}

test('real six immutable reviewed M1 files still drive the full offline PLUS/Deka engine', async () => {
  const {summary} = await loadReviewedRepositoryFixtures()
  assert.equal(summary.sources,6)
  assert.equal(summary.acceptedSources,6)
  assert.equal(summary.rejectedSources,0)
  assert.equal(summary.permissionVerified,false)
  assert.equal(summary.productionEnabled,false)
  assert.equal(summary.publicSavingsClaimEligible,false)
})

test('ordinary one-link bounded JSON regular file survives physical reader unchanged', () =>
  tempFile(async ({file,value}) => {
    assert.deepEqual(await readBoundedRegularReviewedFixture(file),value)
  }))

test('symlink to reviewed evidence cannot impersonate an original regular file', () =>
  tempFile(async ({dir,file}) => {
    const alias = join(dir,'alias.json')
    await symlink(file,alias)
    await assert.rejects(readBoundedRegularReviewedFixture(alias),/bounded regular file/)
  }))

test('hardlink sources are refused even when the caller uses the original pathname', () =>
  tempFile(async ({dir,file,value}) => {
    const other=join(dir,'second-name.json')
    await link(file,other)
    await assert.rejects(readBoundedRegularReviewedFixture(file),/bounded regular file/)
    await assert.rejects(readBoundedRegularReviewedFixture(other),/bounded regular file/)
    await unlink(other)
    assert.deepEqual(await readBoundedRegularReviewedFixture(file),value)
  }))

test('strict UTF-8, oversize, and unsafe path types never create an accepted archive', () =>
  tempFile(async ({file}) => {
    await writeFile(file,Buffer.from([0x7b,0x22,0x61,0x22,0x3a,0x22,0xff,0x22,0x7d]))
    await assert.rejects(readBoundedRegularReviewedFixture(file))
    await writeFile(file,'x'.repeat(1024*1024+1))
    await assert.rejects(readBoundedRegularReviewedFixture(file),/bounded regular file/)
    await assert.rejects(readBoundedRegularReviewedFixture(new Proxy({},{
      get(){throw new Error('unexpected getter')},
    })),/bounded regular file/)
  }))
