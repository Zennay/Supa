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
  assert.match(indexHtml, /<div\s+id=["']root["']><\/div>/)
})

test('app bootstrap entrypoint and mount id stay aligned', () => {
  assert.match(
    indexHtml,
    /<script\s+type=["']module["']\s+src=["']\/src\/main\.tsx["']><\/script>/,
  )
  assert.match(mainSource, /document\.getElementById\(['"]root['"]\)/)
})
