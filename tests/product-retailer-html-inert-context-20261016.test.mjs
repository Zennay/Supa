import test from 'node:test'
import assert from 'node:assert/strict'
import { readAuthorizedHtmlScriptEvidence } from '../scripts/retailer-approved-html-script-evidence.mjs'

// All text is local synthetic HTML. No HTTP, retailer permission or price.
const script = '<script type="application/ld+json">{"name":"active"}</script>'
const inert = '<script type="application/ld+json">{"name":"inert"}</script>'
const blocks = (html) => readAuthorizedHtmlScriptEvidence(html).jsonLdBlocks

test('HTML comment scripts are inert while a later genuine sibling is retained', () => {
  assert.deepEqual(blocks('<!-- ' + inert + ' -->' + script).map(x => x.name), ['active'])
})

test('nested HTML templates cannot leak fake scripts after inner close', () => {
  const html = '<template><template>' + inert + '</template>' + inert + '</template>' + script
  assert.deepEqual(blocks(html).map(x => x.name), ['active'])
})

test('textarea, title and noscript raw content cannot impersonate scripts', () => {
  const html = '<textarea>' + inert + '</textarea><title>' + inert + '</title>' +
    '<noscript>' + inert + '</noscript>' + script
  assert.deepEqual(blocks(html).map(x => x.name), ['active'])
})

test('unterminated inert template hides the rest of its content', () => {
  assert.deepEqual(blocks('<template>' + inert + script), [])
})

test('active script before and after inert template stays in source order', () => {
  const html = script + '<template>' + inert + '</template>' + script
  assert.deepEqual(blocks(html).map(x => x.name), ['active', 'active'])
})

test('comment-like inert marker does not blend across active sibling scripts', () => {
  const html = '<!--' + inert + '-->\n' + script
  assert.equal(readAuthorizedHtmlScriptEvidence(html).invalid, false)
  assert.deepEqual(blocks(html).map(x => x.name), ['active'])
})
