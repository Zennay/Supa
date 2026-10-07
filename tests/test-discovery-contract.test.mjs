import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(testsDirectory)
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
const TEST_LIKE_FILENAME = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx)$/i
const NODE_TEST_SOURCE_FILENAME = /\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx)$/i
const JS_BLOCK_COMMENT_TRIVIA = String.raw`(?:\\s|\\/\\*[\\s\\S]*?\\*\\/)*`
const NODE_TEST_IMPORT_PATTERN = new RegExp(
  String.raw`(?:\\bfrom${JS_BLOCK_COMMENT_TRIVIA}['"]node:test['"]|\\bimport${JS_BLOCK_COMMENT_TRIVIA}['"]node:test['"]|\\bimport${JS_BLOCK_COMMENT_TRIVIA}\\(${JS_BLOCK_COMMENT_TRIVIA}['"]node:test['"]${JS_BLOCK_COMMENT_TRIVIA}\\)|\\brequire${JS_BLOCK_COMMENT_TRIVIA}\\(${JS_BLOCK_COMMENT_TRIVIA}['"]node:test['"]${JS_BLOCK_COMMENT_TRIVIA}\\))`,
)
const NON_SOURCE_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage'])

function isTestLikeEntry(entry) {
  return (
    (entry.isFile() || entry.isSymbolicLink()) &&
    TEST_LIKE_FILENAME.test(entry.name)
  )
}

function sourceImportsNodeTest(source) {
  return NODE_TEST_IMPORT_PATTERN.test(source)
}

async function collectTestLikeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (!NON_SOURCE_DIRECTORIES.has(entry.name)) {
        files.push(...await collectTestLikeFiles(entryPath))
      }
      continue
    }

    if (isTestLikeEntry(entry)) {
      files.push(entryPath)
      continue
    }

    if (entry.isFile() && NODE_TEST_SOURCE_FILENAME.test(entry.name)) {
      const source = await readFile(entryPath, 'utf8')
      if (sourceImportsNodeTest(source)) files.push(entryPath)
    }
  }

  return files
}

function isSelectedByCanonicalNpmTestGlob(repositoryRelativePath) {
  const normalizedPath = repositoryRelativePath.split(sep).join('/')
  const testsPrefix = 'tests/'

  if (!normalizedPath.startsWith(testsPrefix)) {
    return false
  }

  const testsRelativePath = normalizedPath.slice(testsPrefix.length)

  return (
    !testsRelativePath.includes('/') &&
    !testsRelativePath.startsWith('.') &&
    testsRelativePath.endsWith('.test.mjs')
  )
}

test('npm test keeps the explicit top-level Node test glob', () => {
  assert.equal(
    packageJson.scripts?.test,
    'node --experimental-strip-types --test tests/*.test.mjs',
  )
})

test('every repository test-like file remains discoverable by the top-level test glob', async () => {
  const testLikeFiles = await collectTestLikeFiles(repositoryRoot)
  const undiscoveredTests = testLikeFiles
    .map((path) => relative(repositoryRoot, path))
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

test('test discovery recognizes node:test modules even without test-like filenames', () => {
  for (const source of [
    "import check from 'node:test'",
    "import { test as check } from 'node:test'",
    "import 'node:test'",
    "const testApi = await import( 'node:test' )",
    "import check from/* discovery */'node:test'",
    "import/* discovery */'node:test'",
    "const testApi = await import/* discovery */(/* source */'node:test'/* end */)",
    "const testApi = require/* discovery */(/* source */'node:test'/* end */)",
    'const testApi = require( "node:test" )',
  ]) {
    assert.equal(sourceImportsNodeTest(source), true, source)
  }

  for (const source of [
    "import check from './node-test-helper.mjs'",
    "import/* discovery */'./node-test-helper.mjs'",
    "const label = 'node:test'",
  ]) {
    assert.equal(sourceImportsNodeTest(source), false, source)
  }

  assert.equal(
    isSelectedByCanonicalNpmTestGlob(join('tests', 'regression.mjs')),
    false,
  )
})
test('test discovery classifies test-like symlinks without following symlink directories', () => {
  const symlinkedTest = {
    name: 'hidden.spec.mjs',
    isFile: () => false,
    isSymbolicLink: () => true,
  }
  const symlinkedNonTest = {
    name: 'fixture.json',
    isFile: () => false,
    isSymbolicLink: () => true,
  }
  const ordinaryDirectory = {
    name: 'nested.test.mjs',
    isFile: () => false,
    isSymbolicLink: () => false,
  }

  assert.equal(isTestLikeEntry(symlinkedTest), true)
  assert.equal(isTestLikeEntry(symlinkedNonTest), false)
  assert.equal(isTestLikeEntry(ordinaryDirectory), false)
})

test('test discovery rejects hidden, nested and out-of-directory tests outside the canonical glob', () => {
  for (const undiscovered of [
    'tests/.hidden.test.mjs',
    'tests/example.spec.mjs',
    'tests/example.test.js',
    'tests/example.test.ts',
    'tests/example.test.jsx',
    'tests/example.test.tsx',
    join('tests', 'nested', 'example.test.mjs'),
    join('src', 'example.test.mjs'),
    join('src', 'example.test.ts'),
    join('scripts', 'example.spec.mjs'),
  ]) {
    assert.equal(
      isSelectedByCanonicalNpmTestGlob(undiscovered),
      false,
      undiscovered,
    )
  }

  assert.equal(
    isSelectedByCanonicalNpmTestGlob(join('tests', 'example.test.mjs')),
    true,
  )
})
