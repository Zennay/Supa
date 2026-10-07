import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [indexHtml, mainSource] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/main.tsx', 'utf8'),
])

test('app bootstrap keeps one canonical React root target', () => {
  const rootIds = indexHtml.match(/\bid=["']root["']/g) ?? []
  assert.equal(rootIds.length, 1)
  assert.match(indexHtml, /<[^>]+\bid=["']root["'][^>]*>/)
})

test('app bootstrap entrypoint and mount id stay aligned', () => {
  const moduleScripts = indexHtml.match(/<script\b[^>]*><\/script>/g) ?? []
  const entryScript = moduleScripts.find(
    (script) =>
      /\btype=["']module["']/.test(script) &&
      /\bsrc=["']\/src\/main\.tsx["']/.test(script),
  )

  assert.ok(entryScript)
  assert.match(mainSource, /document\.getElementById\(['"]root['"]\)/)
})
