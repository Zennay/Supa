import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

function scriptElements(html) {
  return Array.from(
    html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
    (match) => ({
      attributes: match[1],
      body: match[2],
    }),
  )
}

function evaluateScriptBoundary(html) {
  const scripts = scriptElements(html)
  const issues = []

  if (scripts.length !== 1) {
    issues.push(`expected exactly one script element, found ${scripts.length}`)
    return issues
  }

  const [entry] = scripts
  const type =
    entry.attributes.match(/\btype\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
  const src =
    entry.attributes.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? null

  if (type !== 'module') {
    issues.push('entry script must use type="module"')
  }
  if (src !== '/src/main.tsx') {
    issues.push('entry script must load exactly /src/main.tsx')
  }
  if (entry.body.trim() !== '') {
    issues.push('entry script must not contain inline code')
  }

  return issues
}

test('app shell executes only the canonical first-party module entrypoint', () => {
  assert.deepEqual(evaluateScriptBoundary(indexHtml), [])
})

test('script boundary rejects extra, external and inline execution paths', () => {
  for (const html of [
    '<script type="module" src="/src/main.tsx"></script><script src="https://cdn.example.test/a.js"></script>',
    '<script type="module" src="https://cdn.example.test/main.js"></script>',
    '<script type="module" src="//cdn.example.test/main.js"></script>',
    '<script type="module" src="data:text/javascript,alert(1)"></script>',
    '<script type="module" src="/src/main.tsx">alert(1)</script>',
    '<script src="/src/main.tsx"></script>',
    '<script type="module"></script>',
    '',
  ]) {
    assert.notDeepEqual(evaluateScriptBoundary(html), [], html)
  }
})

test('script boundary accepts the reviewed canonical shell shape', () => {
  assert.deepEqual(
    evaluateScriptBoundary(
      '<!doctype html><html><body><script type="module" src="/src/main.tsx"></script></body></html>',
    ),
    [],
  )
})
