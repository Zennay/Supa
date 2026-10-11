import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RESEARCH_SOURCES,
  main,
  validateResearchSource,
} from '../scripts/m1-multistore-research.mjs'

// Product-core acceptance for the explicitly registered, private-research-only
// source catalog. Offline: no subprocess or retailer requests are made.
test('M1 catalog records cannot be retargeted by mutating any exported identity field', async t => {
  const before = RESEARCH_SOURCES.map(({ id, store, kind, url }) => ({
    id, store, kind, url,
  }))

  for (const [index, source] of RESEARCH_SOURCES.entries()) {
    await t.test(source.id, () => {
      for (const [property, proposed] of Object.entries({
        id: 'alternate-id',
        store: 'dirk',
        kind: 'offers',
        url: 'https://www.ah.nl/other-approved-host-path',
      })) {
        const snapshot = source[property]
        assert.equal(Reflect.set(source, property, proposed), false,
          'changing ' + property + ' must be refused at runtime')
        assert.equal(source[property], snapshot)
        assert.equal(Object.getOwnPropertyDescriptor(source, property)?.writable, false)
      }
      assert.equal(Reflect.deleteProperty(source, 'url'), false)
      assert.equal(Reflect.set(source, 'injectedSource', 'unsafe'), false)
      assert.equal(Object.hasOwn(source, 'injectedSource'), false)
      assert.equal(validateResearchSource(source), true)
      assert.deepEqual(
        { id: source.id, store: source.store, kind: source.kind, url: source.url },
        before[index],
      )
    })
  }
})

test('M1 list CLI retains exactly the immutable registered identities after mutation attempts', async () => {
  const seen = []
  const code = await main(['--list'], {}, (value) => seen.push(value))
  assert.equal(code, 0)
  assert.equal(seen.length, 1)

  const actual = JSON.parse(seen[0])
  assert.deepEqual(actual, RESEARCH_SOURCES.map(({ id, store, kind, url }) => ({
    id, store, kind, url,
  })))
  assert.equal(Object.isFrozen(RESEARCH_SOURCES), true)
  assert.ok(RESEARCH_SOURCES.every((entry) => Object.isFrozen(entry)))
})
