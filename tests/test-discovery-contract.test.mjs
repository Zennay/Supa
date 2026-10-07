import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(testsDirectory)
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
const TEST_LIKE_FILENAME = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx)$/i
const NODE_TEST_SOURCE_FILENAME = /\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx)$/i
const NON_SOURCE_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage'])

function isTestLikeEntry(entry) {
  return (
    (entry.isFile() || entry.isSymbolicLink()) &&
    TEST_LIKE_FILENAME.test(entry.name)
  )
}

function sourceImportsNodeTest(source) {
  const sourceFile = ts.createSourceFile(
    'candidate.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let importsNodeTest = false
  const createRequireAliases = new Set()
  const nodeModuleNamespaceAliases = new Set()
  const nodeModuleDefaultAliases = new Set()
  const runtimeRequireAliases = new Set()

  function isNodeTestSpecifier(node) {
    return ts.isStringLiteralLike(node) && node.text === 'node:test'
  }

  function collectCreateRequireImports(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'node:module' &&
      !node.importClause?.isTypeOnly
    ) {
      const defaultBinding = node.importClause?.name
      if (defaultBinding) {
        nodeModuleDefaultAliases.add(defaultBinding.text)
      }

      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue
          const sourceName = element.propertyName?.text ?? element.name.text
          if (sourceName === 'createRequire') {
            createRequireAliases.add(element.name.text)
          }
        }
      }

      if (bindings && ts.isNamespaceImport(bindings)) {
        nodeModuleNamespaceAliases.add(bindings.name.text)
      }
    }

    ts.forEachChild(node, collectCreateRequireImports)
  }

  function isNodeModuleObjectAlias(node) {
    return (
      ts.isIdentifier(node) &&
      (nodeModuleNamespaceAliases.has(node.text) ||
        nodeModuleDefaultAliases.has(node.text))
    )
  }

  function isCreateRequireCallee(node) {
    return (
      (ts.isIdentifier(node) && createRequireAliases.has(node.text)) ||
      (ts.isPropertyAccessExpression(node) &&
        isNodeModuleObjectAlias(node.expression) &&
        node.name.text === 'createRequire') ||
      (ts.isElementAccessExpression(node) &&
        isNodeModuleObjectAlias(node.expression) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === 'createRequire')
    )
  }

  function isCreateRequireBinding(element) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) return false

    if (!element.propertyName) {
      return element.name.text === 'createRequire'
    }

    return (
      (ts.isIdentifier(element.propertyName) ||
        ts.isStringLiteralLike(element.propertyName)) &&
      element.propertyName.text === 'createRequire'
    )
  }

  function collectRuntimeRequireAliases(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isNodeModuleObjectAlias(node.initializer)
    ) {
      for (const element of node.name.elements) {
        if (isCreateRequireBinding(element)) {
          createRequireAliases.add(element.name.text)
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateRequireCallee(node.initializer)
    ) {
      createRequireAliases.add(node.name.text)
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isCreateRequireCallee(node.initializer.expression)
    ) {
      runtimeRequireAliases.add(node.name.text)
    }

    ts.forEachChild(node, collectRuntimeRequireAliases)
  }

  function visit(node) {
    if (importsNodeTest) return

    if (ts.isImportDeclaration(node) && isNodeTestSpecifier(node.moduleSpecifier)) {
      const clause = node.importClause
      const namedBindings = clause?.namedBindings
      const namedImportsAreTypeOnly =
        namedBindings &&
        ts.isNamedImports(namedBindings) &&
        namedBindings.elements.length > 0 &&
        namedBindings.elements.every((element) => element.isTypeOnly)
      const hasRuntimeDefaultImport = Boolean(clause?.name)

      if (
        !clause?.isTypeOnly &&
        (hasRuntimeDefaultImport || !namedImportsAreTypeOnly)
      ) {
        importsNodeTest = true
        return
      }
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      isNodeTestSpecifier(node.moduleReference.expression)
    ) {
      importsNodeTest = true
      return
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [specifier] = node.arguments
      const callee = node.expression
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
      const isCreateRequireAlias =
        ts.isIdentifier(callee) && runtimeRequireAliases.has(callee.text)
      const isDirectCreateRequireLoad =
        ts.isCallExpression(callee) &&
        isCreateRequireCallee(callee.expression)
      const isModuleRequire =
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'module' &&
          callee.name.text === 'require') ||
        (ts.isElementAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'module' &&
          ts.isStringLiteralLike(callee.argumentExpression) &&
          callee.argumentExpression.text === 'require')
      const isProcessGetBuiltinModule =
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'process' &&
          callee.name.text === 'getBuiltinModule') ||
        (ts.isElementAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'process' &&
          ts.isStringLiteralLike(callee.argumentExpression) &&
          callee.argumentExpression.text === 'getBuiltinModule')

      if (
        (isDynamicImport ||
          isRequire ||
          isCreateRequireAlias ||
          isDirectCreateRequireLoad ||
          isModuleRequire ||
          isProcessGetBuiltinModule) &&
        isNodeTestSpecifier(specifier)
      ) {
        importsNodeTest = true
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  collectCreateRequireImports(sourceFile)
  collectRuntimeRequireAliases(sourceFile)
  visit(sourceFile)
  return importsNodeTest
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
    "import { type TestContext, test as check } from 'node:test'",
    "import check, { type TestContext } from 'node:test'",
    "import 'node:test'",
    "const testApi = await import( 'node:test' )",
    "import check from/* discovery */'node:test'",
    "import/* discovery */'node:test'",
    "const testApi = await import/* discovery */(/* source */'node:test'/* end */)",
    "const testApi = require/* discovery */(/* source */'node:test'/* end */)",
    'const testApi = require( "node:test" )',
    "const testApi = module.require('node:test')",
    'const testApi = module["require"]("node:test")',
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); const testApi = load('node:test')",
    "import { createRequire as makeRequire } from 'node:module'; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import * as moduleApi from 'node:module'; const load = moduleApi.createRequire(import.meta.url); const testApi = load('node:test')",
    "import * as moduleApi from 'node:module'; const testApi = moduleApi['createRequire'](import.meta.url)('node:test')",
    "import moduleApi from 'node:module'; const load = moduleApi.createRequire(import.meta.url); const testApi = load('node:test')",
    "import moduleApi from 'node:module'; const testApi = moduleApi['createRequire'](import.meta.url)('node:test')",
    "import { createRequire } from 'node:module'; const makeRequire = createRequire; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import * as moduleApi from 'node:module'; const makeRequire = moduleApi.createRequire; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import moduleApi from 'node:module'; const makeRequire = moduleApi['createRequire']; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import * as moduleApi from 'node:module'; const { createRequire: makeRequire } = moduleApi; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import moduleApi from 'node:module'; const { createRequire } = moduleApi; const load = createRequire(import.meta.url); const testApi = load('node:test')",
    "import moduleApi from 'node:module'; const { 'createRequire': makeRequire } = moduleApi; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import { createRequire } from 'node:module'; const testApi = createRequire(import.meta.url)('node:test')",
    "const testApi = process.getBuiltinModule('node:test')",
    'const testApi = process["getBuiltinModule"]("node:test")',
    "import check = require('node:test')",
    "const dynamic = `${await import('node:test')}`",
  ]) {
    assert.equal(sourceImportsNodeTest(source), true, source)
  }

  for (const source of [
    "import check from './node-test-helper.mjs'",
    "import/* discovery */'./node-test-helper.mjs'",
    "import type { TestContext } from 'node:test'",
    "import type * as testApi from 'node:test'",
    "import { type TestContext } from 'node:test'",
    "const label = 'node:test'",
    "const fs = module.require('node:fs')",
    "const testApi = helper.require('node:test')",
    "import type { createRequire } from 'node:module'; const load = createRequire(import.meta.url); const testApi = load('node:test')",
    "import { createRequire } from './helper.mjs'; const load = createRequire(import.meta.url); const testApi = load('node:test')",
    "import * as helper from './helper.mjs'; const load = helper.createRequire(import.meta.url); const testApi = load('node:test')",
    "import helper from './helper.mjs'; const load = helper.createRequire(import.meta.url); const testApi = load('node:test')",
    "import * as helper from './helper.mjs'; const makeRequire = helper.createRequire; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import * as helper from './helper.mjs'; const { createRequire: makeRequire } = helper; const load = makeRequire(import.meta.url); const testApi = load('node:test')",
    "import type moduleApi from 'node:module'; const load = moduleApi.createRequire(import.meta.url); const testApi = load('node:test')",
    "import type * as moduleApi from 'node:module'; const load = moduleApi.createRequire(import.meta.url); const testApi = load('node:test')",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); const fs = load('node:fs')",
    "const fs = process.getBuiltinModule('node:fs')",
    "const testApi = helper.getBuiltinModule('node:test')",
    "// import check from 'node:test'",
    "/* const testApi = import('node:test') */",
    "const example = \"import('node:test')\"",
    "const example = `require('node:test')`",
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
