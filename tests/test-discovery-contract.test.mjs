import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
const TEST_LIKE_FILENAME = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx)$/i

async function collectTestLikeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectTestLikeFiles(entryPath))
      continue
    }

    if (entry.isFile() && TEST_LIKE_FILENAME.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

function isSelectedByCanonicalNpmTestGlob(relativePath) {
  const normalizedPath = relativePath.split(sep).join('/')

  return (
    !normalizedPath.includes('/') &&
    !normalizedPath.startsWith('.') &&
    normalizedPath.endsWith('.test.mjs')
  )
}

test('npm test keeps the explicit top-level Node test glob', () => {
  assert.equal(
    packageJson.scripts?.test,
    'node --experimental-strip-types --test tests/*.test.mjs',
  )
})

test('every test-like file remains discoverable by the top-level test glob', async () => {
  const testLikeFiles = await collectTestLikeFiles(testsDirectory)
  const undiscoveredTests = testLikeFiles
    .map((path) => relative(testsDirectory, path))
    .filter((path) => !isSelectedByCanonicalNpmTestGlob(path))

  assert.deepEqual(
    undiscoveredTests,
    [],
    `test-like files are not selected by npm test: ${undiscoveredTests.join(', ')}`,
  )
})

test('test discovery recognizes common JS, TS and React test extensions', () => {
  for (const testLikeFile of [
    'example.test.js',
    'example.spec.mjs',
    'example.test.ts',
    'example.spec.cts',
    'example.test.jsx',
    'example.spec.jsx',
    'example.test.tsx',
    'example.spec.tsx',
  ]) {
    assert.match(testLikeFile, TEST_LIKE_FILENAME, testLikeFile)
  }
})

test('test discovery rejects hidden, nested and wrong-suffix tests outside the canonical glob', () => {
  for (const undiscovered of [
    '.hidden.test.mjs',
    'example.spec.mjs',
    'example.test.js',
    'example.test.ts',
    'example.test.jsx',
    'example.test.tsx',
    join('nested', 'example.test.mjs'),
  ]) {
    assert.equal(
      isSelectedByCanonicalNpmTestGlob(undiscovered),
      false,
      undiscovered,
    )
  }

  assert.equal(
    isSelectedByCanonicalNpmTestGlob('example.test.mjs'),
    true,
  )
})
