import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const persistentStores = new Set(['caches', 'indexedDB'])

function staticName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  if (ts.isComputedPropertyName(node)) return staticName(node.expression)
  return null
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return staticName(node.argumentExpression)
  return null
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function isPersistentBrowserStore(node) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return persistentStores.has(current.text)
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    persistentStores.has(memberName(current))
  )
}

function scriptKindFor(filename) {
  switch (path.extname(filename)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function findPersistentBrowserStore(source, filename = 'candidate.ts') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isIdentifier(node) && persistentStores.has(node.text)) {
      const parent = node.parent
      const isQualifiedMemberName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isElementAccessExpression(parent) && parent.argumentExpression === node)

      if (!isQualifiedMemberName) {
        finding = {
          kind: node.text + ' persistent browser store reference',
          text: node.getText(sourceFile),
        }
        return
      }
    }

    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isPersistentBrowserStore(node)
    ) {
      finding = {
        kind: (memberName(node) ?? 'unknown') + ' persistent browser store reference',
        text: node.getText(sourceFile),
      }
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

async function listProductionSources(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listProductionSources(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('production source has no unreviewed persistent browser stores', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findPersistentBrowserStore(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains an unreviewed persistent browser store: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('persistent-store boundary catches IndexedDB and CacheStorage entry points', () => {
  for (const source of [
    "indexedDB.open('supa')",
    "window['indexedDB'].deleteDatabase('supa')",
    "const dbFactory = globalThis.indexedDB",
    "caches.open('supa-runtime')",
    "self['caches'].match('/basket')",
    "const cacheStorage = window.caches",
  ]) {
    assert.ok(findPersistentBrowserStore(source), source)
  }
})

test('persistent-store boundary preserves local lookalikes and inert text', () => {
  for (const source of [
    "database.indexedDB.open('local')",
    "cacheClient.caches.open('local')",
    "const indexedDBName = 'supa'",
    "const cachesEnabled = false",
    "const example = \"indexedDB.open('example')\"",
    "// caches.open('example')",
  ]) {
    assert.equal(findPersistentBrowserStore(source), null, source)
  }
})
