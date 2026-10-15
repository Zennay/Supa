import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { proposeRetailerSelectors } from '../scripts/retailer-snapshot-selector-proposals.mjs'

// New independent acceptance checks on the exported SHA-verified OFFLINE
// selector-review API. Synthetic captures: no retailer HTTP, price claims,
// production enablement, or product-owner code changes.
function fixture(html, capturedAt = '2026-10-04T12:00:00.000Z') {
  const sha256 = createHash('sha256').update(html).digest('hex')
  return {
    html,
    source: {
      id: 'synthetic-plus-review',
      supermarket: 'plus',
      kind: 'catalog',
      requestedUrl: 'https://www.plus.nl/producten',
      capturedAt,
      sha256,
    },
  }
}

test('complete private synthetic HTML preserves only visible structural selector hints', () => {
  const html = [
    '<!doctype html><html><body>',
    '<article class="product-card"><span class="product-name">FICTIONAL_PRODUCT</span></article>',
    '<script type="application/json"><div class="offer-price">SCRIPT_SECRET</div></script>',
    '<template><div class="product-price">TEMPLATE_SECRET</div></template>',
    '</body></html>',
  ].join('')
  const { source } = fixture(html)
  const result = proposeRetailerSelectors(source, html)
  assert.ok(result.proposedSelectors.some(row => row.selector === 'article.product-card'))
  assert.ok(result.proposedSelectors.some(row => row.selector === 'span.product-name'))
  assert.ok(result.proposedSelectors.every(row =>
    !['div.offer-price', 'div.product-price', 'span.stock-availability'].includes(row.selector)))
  assert.equal(result.readyForScraping, false)
  assert.equal(result.sourcePermissionVerified, false)
  assert.equal(result.currentPricesExtracted, false)
  assert.equal(result.publicationAllowed, false)
  assert.doesNotMatch(JSON.stringify(result), /FICTIONAL_PRODUCT|SCRIPT_SECRET|TEMPLATE_SECRET/)
})

test('even correctly closed HTML comments must never become apparent stock selector proposals', () => {
  const html = '<html><body><article class="product-card">Visible example</article>' +
    '<!-- <span class="stock-availability">COMMENT_SECRET</span> -->' +
    '</body></html>'
  const { source } = fixture(html)
  const report = proposeRetailerSelectors(source, html)
  assert.ok(report.proposedSelectors.some(row => row.selector === 'article.product-card'))
  assert.ok(report.proposedSelectors.every(row => row.selector !== 'span.stock-availability'),
    'a closed comment has no visible stock element: do not count it')
  assert.doesNotMatch(JSON.stringify(report), /COMMENT_SECRET/)
  assert.equal(report.publicationAllowed, false)
})

test('unterminated script containing fake HTML cannot produce apparent visible product/offer selectors', () => {
  const html = '<html><body><article class="product-card">Fictional</article>' +
    '<script type="application/json">{"preview":"<div class=\"offer-price\">UNVERIFIED_PROMO</div>"'
  const { source } = fixture(html)
  assert.throws(() => proposeRetailerSelectors(source, html),
    /Offline selector review refused/,
    'unterminated script must fail closed, not treat script text as visible DOM')
})

test('unterminated template containing fake price classes fails closed', () => {
  const html = '<html><body><template><section class="product-price">HIDDEN_FAKE</section>'
  const { source } = fixture(html)
  assert.throws(() => proposeRetailerSelectors(source, html),
    /Offline selector review refused/,
    'unclosed inert template must not be counted as live product DOM')
})

test('unterminated comment containing fake availability classes fails closed', () => {
  const html = '<html><body><!-- <div class="stock-availability">HIDDEN_FAKE</div>'
  const { source } = fixture(html)
  assert.throws(() => proposeRetailerSelectors(source, html),
    /Offline selector review refused/,
    'unterminated HTML comment must not supply stock candidates')
})

test('future-dated fully SHA-matched capture cannot impersonate an observed historical page', () => {
  const html = '<html><body><span class="product-name">SYNTHETIC</span></body></html>'
  const { source } = fixture(html, '2035-10-04T12:00:00.000Z')
  assert.throws(() => proposeRetailerSelectors(source, html),
    /Offline selector review refused/,
    'cryptographically bound HTML is not enough when the claimed observation is in the future')
})
