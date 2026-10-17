import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'

// QA-only / no retailer network. Distinct from monetary QA: this tests 11×2
// HTML *text* sinks, escaping, and private metadata noninterference.
function report() {
  const result = buildPrivateM3ProductComparison(buildFictionalPricedSheet(90))
  assert.equal(result.lines.length, 11)
  assert.equal(result.publicSavingsClaimEligible, false)
  return result
}

// Deliberately independent of renderer implementation.
function escapeHtml(value) {
  return [...String(value)].map(ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch] ?? ch)).join('')
}

const probes = [
  '<img src=x onerror="alert(1)">',
  '<script src="https://fictional.invalid/qa.js">alert(1)</script>',
  '<svg onload="alert(1)"></svg>',
  '</strong><iframe srcdoc="<script>alert(1)</script>">',
  '<a href="javascript:alert(1)">QA</a>',
  '<style>body{display:none}</style>',
  '&lt;svg onload=alert(1)&gt;',
  '" onclick="alert(1)',
  "' onmouseover='alert(1)",
  '<!-- comment -->& < > " \'',
  '\u202e<math href="javascript:alert(1)">',
  '🍎 ̶َ x <b class="qa"> &amp;',
]

test('M3 private HTML: exact independent escape oracle over 11×2 hostile product text sinks', () => {
  let exercised = 0
  for (const payload of probes) {
    for (let i = 0; i < 11; i++) {
      for (const store of ['plus', 'dekamarkt']) {
        const input = report()
        input.lines[i][store].productName = 'QA_UNTRUSTED_' + payload
        const prior = JSON.stringify(input)
        const html = renderPrivateM3ProductComparisonHtml(input)
        assert.ok(html.includes('<strong>' + escapeHtml('QA_UNTRUSTED_' + payload) + '</strong>'),
          'escaping must be in actual product text context')
        assert.doesNotMatch(html, /<(?:script|img|svg|iframe|a|math)\b/iu,
          'an untrusted label must not create an active HTML tag')
        assert.equal(JSON.stringify(input), prior, 'renderer must not mutate the original report')
        assert.equal(input.publicSavingsClaimEligible, false)
        exercised++
      }
    }
  }
  assert.equal(exercised, 264)
})

test('M3 private HTML: all 11 ingredient labels escape special text while totals remain cents-based', () => {
  const input = report()
  const priorTotals = structuredClone(input.fullBasket)
  for (let i = 0; i < 11; i++) {
    input.lines[i].ingredientLabel = 'QA_INGREDIENT_' + i + '_' + probes[i]
  }
  const original = JSON.stringify(input)
  const html = renderPrivateM3ProductComparisonHtml(input)
  for (let i = 0; i < 11; i++) {
    const escaped = escapeHtml(input.lines[i].ingredientLabel)
    assert.ok(html.includes('<th scope="row">' + escaped + '<small>'),
      '11 canonical ingredient names must be inert in row-header context')
  }
  assert.deepEqual(input.fullBasket, priorTotals)
  assert.equal(JSON.stringify(input), original)
  assert.equal((html.match(/<tr><th scope="row">/gu) ?? []).length, 11)
  assert.doesNotMatch(html, /<(?:script|img|svg|iframe|a|math)\b/iu)
})

test('M3 HTML: structured private/nonpublic metadata does not enter offline document output', () => {
  const a = report()
  const b = structuredClone(a)
  const canaries = [
    'QA_PRIVATE_STUDY_ALPHA_8374', 'QA_PRIVATE_PARTICIPANT_BETA_6258',
    'QA_PRIVATE_EVIDENCE_ZETA_5943', 'QA_PRIVATE_SOURCE_URL_DELTA_4129',
  ]
  b.study = { studyId: canaries[0], participantKey: canaries[1] }
  b.lines[0].plus.provenanceNote = canaries[2]
  b.lines[1].dekamarkt.sourceUrl = 'https://fictional.invalid/' + canaries[3]
  const baseline = renderPrivateM3ProductComparisonHtml(a)
  const modified = renderPrivateM3ProductComparisonHtml(b)
  assert.equal(modified, baseline,
    'non-display private identifiers and source URLs must not change HTML bytes')
  for (const secret of canaries) assert.equal(modified.includes(secret), false)
  assert.match(modified, /Niet onafhankelijk geverifieerd/u)
  assert.doesNotMatch(modified, /https:\/\/fictional.invalid/u)
})

test('M3 HTML: offline CSP and no external resource or script execution surfaces', () => {
  const html = renderPrivateM3ProductComparisonHtml(report())
  for (const directive of [
    "default-src 'none'", "script-src 'none'", "img-src 'none'",
    "base-uri 'none'", "form-action 'none'",
  ]) assert.ok(html.includes(directive), 'missing inert offline CSP: ' + directive)
  assert.equal((html.match(/Content-Security-Policy/gu) ?? []).length, 1)
  assert.doesNotMatch(html, /<(?:script|iframe|object|embed|form|link|img|svg|base)\b/iu)
  assert.doesNotMatch(html, /(?:src|href|srcdoc)\s*=/iu)
  assert.match(html, /Privé prijsvergelijking/u)
  assert.match(html, /geen openbare besparingsclaim/u)
})
