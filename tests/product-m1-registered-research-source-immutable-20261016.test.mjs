import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RESEARCH_SOURCES,
  validateResearchSource,
  captureResearchSource,
} from '../scripts/m1-multistore-research.mjs'

// Registry integrity only: no retailer network, authorized capture, prices or
// rights inferred from this test.
test('fixed M1 research registry is deeply frozen without changing reviewed URLs', () => {
  assert.equal(RESEARCH_SOURCES.length, 5)
  assert.ok(Object.isFrozen(RESEARCH_SOURCES))
  const originals = [
    ['ah-halfvolle-melk', 'https://www.ah.nl/producten/product/wi1525/halfvolle-melk'],
    ['dirk-boodschappen', 'https://www.dirk.nl/boodschappen'],
    ['dirk-halvarine', 'https://www.dirk.nl/boodschappen/zuivel-kaas/boter-margarine/1%20de%20beste%20halvarine/113861'],
    ['hoogvliet-magere-melk', 'https://www.hoogvliet.com/product/melkan-magere-melk'],
    ['jumbo-halfvolle-melk', 'https://www.jumbo.com/producten/jumbo-halfvolle-melk-500ml-753539PAK'],
  ]
  assert.deepEqual(RESEARCH_SOURCES.map(entry => [entry.id, entry.url]), originals)
  for (const entry of RESEARCH_SOURCES) {
    assert.equal(Object.isFrozen(entry), true)
    assert.equal(validateResearchSource(entry), true)
  }
})

test('same-host retargeting cannot alter the registered research URLs', () => {
  const original = RESEARCH_SOURCES.map(source => source.url)
  for (const source of RESEARCH_SOURCES) {
    const candidate = new URL(source.url)
    candidate.pathname = '/another-unreviewed-product'
    assert.equal(Reflect.set(source, 'url', candidate.href), false)
    assert.equal(Reflect.deleteProperty(source, 'url'), false)
    assert.equal(Reflect.set(source, 'qaExtraUrl', 'https://example.test'), false)
    assert.equal(validateResearchSource(source), true)
  }
  assert.deepEqual(RESEARCH_SOURCES.map(source => source.url), original)
})

test('unapproved research attempts still abort before any transport is invoked', async () => {
  const source = RESEARCH_SOURCES[0]
  await assert.rejects(
    captureResearchSource(source.id, {
      env: { SUPA_RESEARCH_APPROVED: '0', PATH: '/nonexistent' },
      outputDir: '/tmp/supa-research-unapproved-never-written',
    }),
    /explicitly set SUPA_RESEARCH_APPROVED=1/,
  )
})
