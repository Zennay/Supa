import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

function openingTags(html, tagName) {
  const pattern = new RegExp('<' + tagName + '\\b[^>]*>', 'gi')
  return [...stripHtmlComments(html).matchAll(pattern)].map(([tag]) => tag)
}

function attributeValue(tag, name) {
  const pattern = new RegExp(
    '\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))',
    'i',
  )
  const match = tag.match(pattern)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

function evaluateShellNavigationBoundary(html) {
  const issues = []

  for (const tag of openingTags(html, 'meta')) {
    const httpEquiv = attributeValue(tag, 'http-equiv')
    if (httpEquiv?.trim().toLowerCase() === 'refresh') {
      issues.push('meta refresh navigation is forbidden')
    }
  }

  for (const tag of openingTags(html, 'base')) {
    issues.push('base element is forbidden: ' + tag)
  }

  return issues
}

test('app shell has no declarative redirect or base navigation override', () => {
  assert.deepEqual(evaluateShellNavigationBoundary(indexHtml), [])
})

test('shell navigation boundary rejects meta refresh and base elements', () => {
  for (const html of [
    '<meta http-equiv="refresh" content="0;url=https://example.test">',
    "<meta content='5; URL=/elsewhere' HTTP-EQUIV='Refresh'>",
    '<meta http-equiv=refresh content="0;url=/elsewhere">',
    '<base href="https://example.test/">',
    '<base target="_blank">',
  ]) {
    assert.notDeepEqual(evaluateShellNavigationBoundary(html), [], html)
  }
})

test('shell navigation boundary preserves ordinary metadata and inert text', () => {
  for (const html of [
    '<meta name="referrer" content="no-referrer">',
    '<meta name="theme-color" content="#f7f6f1">',
    '<meta name="description" content="refresh">',
    '&lt;base href="https://example.test/"&gt;',
    '<!-- <meta http-equiv="refresh" content="0;url=/example"> -->',
  ]) {
    assert.deepEqual(evaluateShellNavigationBoundary(html), [], html)
  }
})
