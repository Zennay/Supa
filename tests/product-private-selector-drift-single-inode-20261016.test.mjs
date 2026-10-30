import assert from 'node:assert/strict'
import { chmod, link, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { main } from '../scripts/retailer-private-selector-drift.mjs'

const html = '<article class="product-card"><span class="price-value">private fabricated</span></article>'
const sample = capturedAt => proposeOfflineRetailerSelectors({
  html,
  origin: { retailerId:'plus', url:'https://www.plus.nl/producten', capturedAt },
})
const denied = /Private selector drift comparison refused/
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-selector-archive-identity-'))
  const old = join(dir, 'old.json')
  const next = join(dir, 'next.json')
  try {
    await writeFile(old, JSON.stringify(sample('2024-02-29T10:00:00Z')), { mode:0o600 })
    await writeFile(next, JSON.stringify(sample('2026-10-14T10:00:00Z')), { mode:0o600 })
    return await fn({ dir, old, next })
  } finally {
    await chmod(dir,0o700)
    await rm(dir,{recursive:true,force:true})
  }
}

test('physical hardlink aliases cannot appear as two independent historical archived captures', () =>
  fixture(async ({ dir, old }) => {
    const alias = join(dir, 'alias.json')
    await link(old,alias)
    let output = ''
    await assert.rejects(main(['--before',old,'--after',alias], x=>{output+=x}),denied)
    assert.equal(output,'')
  }))

test('hardlinked archive cannot be admitted even when compared with an unrelated valid file', () =>
  fixture(async ({ dir, old, next }) => {
    await link(old,join(dir,'shadow.json'))
    let output = ''
    await assert.rejects(main(['--before',old,'--after',next],x=>{output+=x}),denied)
    assert.equal(output,'')
  }))

test('owner-only staging directory is required, not just restrictive JSON file mode', () =>
  fixture(async ({ dir, old, next }) => {
    await chmod(dir,0o755)
    let output = ''
    await assert.rejects(main(['--before',old,'--after',next],x=>{output+=x}),denied)
    assert.equal(output,'')
    await chmod(dir,0o700)
    const report=await main(['--before',old,'--after',next],x=>{output+=x})
    assert.equal(report.permissionVerified,false)
    assert.equal(report.publicSavingsClaimEligible,false)
    assert.equal(report.externalRequests,0)
    assert.doesNotMatch(output,/private fabricated|plus\.nl|sha256|capturedAt/)
  }))

test('valid distinct stable 0600 files retain private aggregate comparison and unchanged bytes', () =>
  fixture(async ({ old, next }) => {
    let output = ''
    const report = await main(['--before',old,'--after',next],x=>{output+=x})
    assert.equal(report.mode,'private-offline-selector-drift-alert')
    assert.equal(report.automatedSelectorPromotion,false)
    assert.equal(report.productionEnabled,false)
    assert.equal(report.publicSavingsClaimEligible,false)
    assert.deepEqual(JSON.parse(output),report)
  }))
