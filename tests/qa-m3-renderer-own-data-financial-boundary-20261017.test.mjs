import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Independent QA-only diagnostics; fictional 11x2 report, no HTTP/customer data.
// Correct behavior: accept only inert, own-data financial/display facts before
// formatting. Refusal is valid; never execute untrusted property accessors.
const fixture = () => {
  const report = buildPrivateM3ProductComparison(buildFictionalPricedSheet(90))
  assert.equal(report.lines.length, 11)
  assert.equal(report.fullBasket.comparable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  return report
}
const renderers = [
  ['HTML', renderPrivateM3ProductComparisonHtml],
  ['CSV', renderPrivateM3ComparisonCsv],
]
function safeRender(render, report, secret) {
  let output
  let failure
  try {
    output = render(report)
  } catch (error) {
    failure = error
  }
  if (failure !== undefined) {
    assert.equal(String(failure).includes(secret), false, 'private error leaked through exception')
  } else {
    assert.equal(typeof output, 'string')
    assert.equal(output.includes(secret), false, 'untrusted accessor secret surfaced in output')
  }
}
for (const [format, render] of renderers) {
  test(format + ' accepts normal frozen own-data report and leaves it unchanged', () => {
    const report = fixture()
    const original = JSON.stringify(report)
    const document = render(report)
    assert.ok(document.length > 100)
    assert.equal(JSON.stringify(report), original)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.match(document, /Niet onafhankelijk geverifieerd|NIET GEVERIFIEERD/u)
  })

  for (const [label, locate, field] of [
    ['known-pack monetary cents', r => r.lines[0].plus, 'pricePerPackageCents'],
    ['human product display name', r => r.lines[0].dekamarkt, 'productName'],
    ['whole-basket financial cents', r => r.fullBasket, 'plusTotalCents'],
    ['physical ingredient label', r => r.lines[0], 'ingredientLabel'],
  ]) {
    test(format + ' must not invoke getter-backed ' + label, () => {
      const report = fixture()
      const target = locate(report)
      const original = target[field]
      let invoked = 0
      const marker = 'PRIVATE_QA_ACCESSOR_NEVER_RENDER_20261017'
      Object.defineProperty(target, field, {
        enumerable: true,
        configurable: true,
        get() {
          invoked++
          return original
        },
      })
      safeRender(render, report, marker)
      assert.equal(invoked, 0, 'private rendering executed untrusted accessor')
    })
  }

  test(format + ' must reject an inherited money field rather than trusting a prototype', () => {
    const report = fixture()
    const original = report.lines[0].plus.pricePerPackageCents
    delete report.lines[0].plus.pricePerPackageCents
    Object.setPrototypeOf(report.lines[0].plus, { pricePerPackageCents: original })
    assert.throws(() => render(report), undefined,
      'prototype-inherited financial metadata cannot authorize displayed cents')
  })

  test(format + ' must never expose a throwing getter secret or execute it', () => {
    const report = fixture()
    let invoked = 0
    const marker = 'PRIVATE_QA_GETTER_THROW_SECRET_20261017'
    Object.defineProperty(report.fullBasket, 'deltaCents', {
      configurable: true,
      enumerable: true,
      get() {
        invoked++
        throw new Error(marker)
      },
    })
    safeRender(render, report, marker)
    assert.equal(invoked, 0, 'renderer must not invoke throwing source fields')
  })
}
