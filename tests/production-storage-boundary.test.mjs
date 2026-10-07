import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const storageNames = new Set(['localStorage', 'sessionStorage'])
const keyedMethods = new Set(['getItem', 'removeItem', 'setItem'])

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

function storageName(node) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current) && storageNames.has(current.text)) {
    return current.text
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return null
  }

  const base = unwrapExpression(current.expression)
  if (!ts.isIdentifier(base) || !browserRoots.has(base.text)) return null

  const name = memberName(current)
  return storageNames.has(name) ? name : null
}

function staticString(node) {
  if (!node) return null
  const current = unwrapExpression(node)
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text
  }
  return null
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

function findUnsafeStorageAccess(source, filename = 'candidate.tsx') {
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

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const storage = storageName(callee.expression)
        const method = memberName(callee)

        if (storage && method === 'clear') {
          finding = {
            kind: 'origin-wide storage clear',
            text: callee.getText(sourceFile),
          }
          return
        }

        if (storage && keyedMethods.has(method)) {
          const key = staticString(node.arguments[0])
          if (key !== null && !key.startsWith('supa:')) {
            finding = {
              kind: 'unscoped storage key',
              text: node.getText(sourceFile),
            }
            return
          }
        }
      }
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

test('production browser storage stays scoped to SUPA data', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findUnsafeStorageAccess(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains unsafe browser storage access: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('storage guard rejects origin-wide clears and unscoped literal keys', () => {
  for (const source of [
    'localStorage.clear()',
    "window['localStorage']['clear']()",
    'globalThis.sessionStorage.clear()',
    "localStorage.setItem('planner', '{}')",
    'window.localStorage.getItem("shopping-list")',
    "self['sessionStorage'].removeItem(`draft`)",
  ]) {
    assert.ok(findUnsafeStorageAccess(source), source)
  }
})

test('storage guard permits SUPA literal keys, named keys and unrelated storage objects', () => {
  for (const source of [
    "localStorage.setItem('supa:planner-preferences:v2', '{}')",
    "window.localStorage.getItem('supa:shopping-list:v1')",
    "sessionStorage.removeItem('supa:temporary:v1')",
    'localStorage.setItem(storageKey, payload)',
    'window.localStorage.getItem(storageKey)',
    'cache.clear()',
    "storage.setItem('planner', '{}')",
    "// localStorage.clear()",
    "const example = \"localStorage.setItem('planner', '{}')\"",
  ]) {
    assert.equal(findUnsafeStorageAccess(source), null, source)
  }
})
