import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLUS_RENDERED_LISTING_SELECTORS as CSS,
  projectPlusRenderedListingCard,
} from '../src/data/plusRenderedListings.ts'

// Synthetic in-memory DOM contract, never a claim of real retailer DOM capture,
// source authorization, availability, live prices or M3 savings.
const validHref = '/product/fictional-plus-shelf-123456'
const list = items => Object.assign([...items], { item(index) { return this[index] ?? null } })
function fakeCard(kind, overrides = {}) {
  const values = {
    [CSS.name]: ['Fictional 500g oats'],
    [CSS.pack]: ['Per 500 gram'],
    [CSS.priceInteger]: ['2.'],
    [CSS.priceDecimals]: ['49'],
    [CSS.previousPrice]: kind === 'offers' ? ['3.19'] : [],
    ...overrides.fields,
  }
  const anchors = []
  const block = {
    querySelectorAll(selector) {
      if (selector === CSS.cardAnchor) return list(overrides.anchors ?? anchors)
      return list((values[selector] ?? []).map(text => ({ textContent: text })))
    },
  }
  const anchor = {
    matches: selector => selector === CSS.cardAnchor && overrides.matched !== false,
    closest: selector => (selector === '[data-block="' +
      (kind === 'catalog' ? CSS.catalogBlock : CSS.offersBlock) + '"]' &&
      overrides.hasBlock !== false ? block : null),
    getAttribute: name => name === 'href' ? (overrides.href ?? validHref) : null,
  }
  anchors.push(anchor)
  return { anchor, block, values, anchors }
}

test('valid PLUS catalog DOM physical card gets one conservative typed projection', () => {
  const { anchor } = fakeCard('catalog')
  const card = projectPlusRenderedListingCard(anchor, 'catalog')
  assert.deepEqual(card, {
    block: CSS.catalogBlock, href: validHref, name: 'Fictional 500g oats',
    packText: 'Per 500 gram', priceInteger: '2.',
    priceDecimals: '49', previousPriceText: '',
  })
})

test('valid PLUS offers DOM card is projected but no offer timing or checkout claim is inferred', () => {
  const { anchor } = fakeCard('offers')
  const card = projectPlusRenderedListingCard(anchor, 'offers')
  assert.equal(card.block, CSS.offersBlock)
  assert.equal(card.previousPriceText, '3.19')
  assert.equal(Object.hasOwn(card, 'availability'), false)
  assert.equal(Object.hasOwn(card, 'validTo'), false)
})

test('two product anchors sharing one block can never cross-borrow one price/name/pack', () => {
  const a = fakeCard('catalog')
  const another = { ...a.anchor }
  a.anchors.push(another)
  assert.equal(projectPlusRenderedListingCard(a.anchor, 'catalog'), null)
  assert.equal(projectPlusRenderedListingCard(another, 'catalog'), null)
})

test('DOM identity must be the exact anchor observed inside its own nearest card block', () => {
  const a = fakeCard('catalog', { matched: false })
  assert.equal(projectPlusRenderedListingCard(a.anchor, 'catalog'), null)
  const b = fakeCard('catalog', { hasBlock: false })
  assert.equal(projectPlusRenderedListingCard(b.anchor, 'catalog'), null)
  const c = fakeCard('catalog', { anchors: [{}] })
  assert.equal(projectPlusRenderedListingCard(c.anchor, 'catalog'), null)
  const d = fakeCard('catalog', { href: '/other/foreign-123456' })
  assert.equal(projectPlusRenderedListingCard(d.anchor, 'catalog'), null)
})

test('duplicate labels, packs, split prices, and old-price badges do not silently select cheaper inner node', () => {
  for (const [selector, values] of [
    [CSS.name, ['Wrong', 'Fictional 500g oats']],
    [CSS.pack, ['Per 1 gram', 'Per 500 gram']],
    [CSS.priceInteger, ['0.', '2.']],
    [CSS.priceDecimals, ['01', '49']],
    [CSS.previousPrice, ['3.19', '9.99']],
  ]) {
    const { anchor } = fakeCard('offers', { fields: { [selector]: values } })
    assert.equal(projectPlusRenderedListingCard(anchor, 'offers'), null, selector)
  }
})

test('required missing/unreadable fields never turn into purchasable or reviewed DOM evidence', () => {
  for (const [selector, values] of [
    [CSS.name, []], [CSS.name, ['']],
    [CSS.pack, []], [CSS.pack, ['unknown']],
    [CSS.priceInteger, []], [CSS.priceInteger, ['invalid']],
    [CSS.priceDecimals, []], [CSS.priceDecimals, ['abc']],
  ]) {
    const { anchor } = fakeCard('catalog', { fields: { [selector]: values } })
    assert.equal(projectPlusRenderedListingCard(anchor, 'catalog'), null, selector)
  }
})

test('ambiguous or inverted original offer money is rejected at the DOM projection boundary', () => {
  for (const previous of ['', '2.49', '1.00', '0.00', 'not-a-price']) {
    const { anchor } = fakeCard('offers', { fields: { [CSS.previousPrice]: previous ? [previous] : [] } })
    assert.equal(projectPlusRenderedListingCard(anchor, 'offers'), null, previous)
  }
  const catalog = fakeCard('catalog', { fields: { [CSS.previousPrice]: ['3.19'] } })
  assert.equal(projectPlusRenderedListingCard(catalog.anchor, 'catalog'), null)
})

test('changed or hostile DOM selectors and invalid kinds fail without running network code', () => {
  const { anchor } = fakeCard('catalog')
  assert.equal(projectPlusRenderedListingCard(anchor, 'offers'), null)
  assert.equal(projectPlusRenderedListingCard(anchor, 'unknown'), null)
  const hostile = { matches: () => { throw new Error('synthetic DOM exception') } }
  assert.equal(projectPlusRenderedListingCard(hostile, 'catalog'), null)
})
