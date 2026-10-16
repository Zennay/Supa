import assert from 'node:assert/strict'
import test from 'node:test'
import { link, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
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

test('ambiguous duplicate provenance and price money cannot pass the raw reviewed file boundary', () =>
  tempFile(async ({file}) => {
    const ambiguous = [
      '{"version":1,"source":{"supermarket":"plus"},"source":{"supermarket":"dekamarkt"}}',
      String.raw`{"source":{"capturedAt":"2026-10-04T18:15:30.306Z","captured\u0041t":"2026-10-05T18:15:30.306Z"}}`,
      '{"offer":{"offerPriceCents":199,"offerPriceCents":1}}',
    ]
    for (const source of ambiguous) {
      await writeFile(file,source,{mode:0o600})
      await assert.rejects(readBoundedRegularReviewedFixture(file),/Ambiguous|invalid/)
    }
    await writeFile(file,'{"source":{"capturedAt":"2026-10-04T18:15:30.306Z"},"offer":{"offerPriceCents":199}}',{mode:0o600})
    const parsed=await readBoundedRegularReviewedFixture(file)
    assert.equal(parsed.offer.offerPriceCents,199)
  }))

test('a linked parent or two-hop linked ancestor cannot impersonate a reviewed archive', () =>
  tempFile(async ({dir}) => {
    const actual=join(dir,'actual')
    await mkdir(actual,{mode:0o700})
    const file=join(actual,'private.json')
    await writeFile(file,'{"schemaVersion":1}',{mode:0o600})
    const alias=join(dir,'alias')
    await symlink(actual,alias,'dir')
    await assert.rejects(
      readBoundedRegularReviewedFixture(join(alias,'private.json')),
      /symlink ancestor|Reviewed fixture/i,
    )
    const second=join(dir,'second-alias')
    await symlink(alias,second,'dir')
    await assert.rejects(
      readBoundedRegularReviewedFixture(join(second,'private.json')),
      /symlink ancestor|Reviewed fixture/i,
    )
    assert.deepEqual(await readBoundedRegularReviewedFixture(file),{schemaVersion:1})
  }))
