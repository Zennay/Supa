import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

function openingTags(source, tagName) {
  const pattern = new RegExp('<' + tagName + '\\b[^>]*>', 'gi')
  return [...stripHtmlComments(source).matchAll(pattern)].map(([tag]) => tag)
}

function attributeValue(tag, name) {
  const pattern = new RegExp(
    '\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))',
    'i',
  )
  const match = tag.match(pattern)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

function cspDeclarations(source = html) {
  return openingTags(source, 'meta')
    .filter((tag) => attributeValue(tag, 'http-equiv')?.trim().toLowerCase() === 'content-security-policy')
    .map((tag) => attributeValue(tag, 'content') ?? '')
}

function parsePolicy(policy) {
  const directives = new Map()

  for (const declaration of policy.split(';')) {
    const tokens = declaration.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue

    const [name, ...sources] = tokens
    assert.equal(directives.has(name), false, 'duplicate CSP directive: ' + name)
    directives.set(name, sources)
  }

  return directives
}

test('app shell keeps one restrictive same-origin Content Security Policy', () => {
  const policies = cspDeclarations()

  assert.equal(policies.length, 1, 'expected exactly one CSP meta declaration')
  const directives = parsePolicy(policies[0])

  assert.deepEqual(
    [...directives.keys()].sort(),
    [
      'base-uri',
      'connect-src',
      'default-src',
      'font-src',
      'form-action',
      'img-src',
      'object-src',
      'script-src',
      'style-src',
    ].sort(),
  )

  assert.deepEqual(directives.get('default-src'), ["'self'"])
  assert.deepEqual(directives.get('base-uri'), ["'none'"])
  assert.deepEqual(directives.get('object-src'), ["'none'"])
  assert.deepEqual(directives.get('script-src'), ["'self'"])
  assert.deepEqual(directives.get('style-src'), ["'self'"])
  assert.deepEqual(directives.get('img-src'), ["'self'", 'data:'])
  assert.deepEqual(directives.get('font-src'), ["'self'"])
  assert.deepEqual(directives.get('connect-src'), ["'self'"])
  assert.deepEqual(directives.get('form-action'), ["'self'"])
})

test('CSP contract rejects duplicate declarations and dangerous source tokens', () => {
  assert.equal(
    cspDeclarations(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">' +
      '<meta HTTP-EQUIV=Content-Security-Policy content="default-src \'self\'">',
    ).length,
    2,
  )

  for (const unsafe of [
    "default-src *",
    "script-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-eval'",
    "connect-src https:",
    "img-src data: https://example.test",
  ]) {
    const directives = parsePolicy(unsafe)
    const tokens = [...directives.values()].flat()
    assert.ok(
      tokens.some((token) =>
        token === '*' ||
        token === "'unsafe-inline'" ||
        token === "'unsafe-eval'" ||
        /^[a-z][a-z0-9+.-]*:$/i.test(token) && token !== 'data:' ||
        /^https?:\/\//i.test(token),
      ),
      unsafe,
    )
  }
})

test('CSP parser ignores inert text and ordinary metadata', () => {
  assert.deepEqual(
    cspDeclarations(
      '<meta name="description" content="Content-Security-Policy">' +
      '<!-- <meta http-equiv="Content-Security-Policy" content="default-src *"> -->',
    ),
    [],
  )
})
