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

function isBrowserGlobalObject(node, expectedName) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) return current.text === expectedName

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    memberName(current) === expectedName
  )
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

function parseSource(source, filename = 'candidate.tsx') {
  return ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )
}

function collectScopedStorageKeyBindings(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  const bindings = new Set()

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const value = staticString(node.initializer)
      if (value?.startsWith('supa:')) bindings.add(node.name.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return bindings
}

function storageKeyIsScoped(node, scopedKeyBindings) {
  const value = staticString(node)
  if (value !== null) return value.startsWith('supa:')

  const current = node ? unwrapExpression(node) : null
  return (
    current !== null &&
    ts.isIdentifier(current) &&
    scopedKeyBindings.has(current.text)
  )
}

function findUnsafeStorageAccess(
  source,
  filename = 'candidate.tsx',
  scopedKeyBindings = new Set(),
) {
  const sourceFile = parseSource(source, filename)
  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node)

      if (name === 'cookie' && isBrowserGlobalObject(node.expression, 'document')) {
        finding = {
          kind: 'document.cookie access',
          text: node.getText(sourceFile),
        }
        return
      }

      if (
        isBrowserGlobalObject(node, 'cookieStore') ||
        isBrowserGlobalObject(node.expression, 'cookieStore')
      ) {
        finding = {
          kind: 'client cookieStore access',
          text: node.getText(sourceFile),
        }
        return
      }
    }

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

        if (
          storage &&
          keyedMethods.has(method) &&
          !storageKeyIsScoped(node.arguments[0], scopedKeyBindings)
        ) {
          finding = {
            kind: 'unscoped or unverifiable storage key',
            text: node.getText(sourceFile),
          }
          return
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

  const sources = await Promise.all(
    files.map(async (file) => ({
      ...file,
      source: await readFile(file.url, 'utf8'),
    })),
  )
  const scopedKeyBindings = new Set()

  for (const file of sources) {
    for (const binding of collectScopedStorageKeyBindings(file.source, file.relativePath)) {
      scopedKeyBindings.add(binding)
    }
  }

  for (const file of sources) {
    const finding = findUnsafeStorageAccess(
      file.source,
      file.relativePath,
      scopedKeyBindings,
    )

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains unsafe browser storage access: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('storage guard rejects origin-wide clears and unscoped or unverifiable keys', () => {
  for (const source of [
    'localStorage.clear()',
    "window['localStorage']['clear']()",
    'globalThis.sessionStorage.clear()',
    "localStorage.setItem('planner', '{}')",
    'window.localStorage.getItem("shopping-list")',
    "self['sessionStorage'].removeItem(`draft`)",
    'localStorage.setItem(storageKey, payload)',
    'window.localStorage.getItem(buildStorageKey())',
    "document.cookie = 'session=unsafe'",
    "const raw = window['document'].cookie",
    "cookieStore.set('session', 'unsafe')",
    "window.cookieStore.get('session')",
    "globalThis['cookieStore']['delete']('session')",
  ]) {
    const bindings = collectScopedStorageKeyBindings(source)
    assert.ok(findUnsafeStorageAccess(source, 'candidate.tsx', bindings), source)
  }
})

test('storage guard permits proven SUPA keys and unrelated storage objects', () => {
  for (const source of [
    "localStorage.setItem('supa:planner-preferences:v2', '{}')",
    "window.localStorage.getItem('supa:shopping-list:v1')",
    "sessionStorage.removeItem('supa:temporary:v1')",
    "const storageKey = 'supa:planner:v1'; localStorage.setItem(storageKey, payload)",
    "const storageKey = 'supa:list:v1'; window.localStorage.getItem(storageKey)",
    'cache.clear()',
    "storage.setItem('planner', '{}')",
    "jar.cookie = 'local-only'",
    "const cookie = 'local label'",
    "cookies.set('session', 'local-only')",
    "jar.cookieStore.get('session')",
    "// document.cookie = 'example=1'",
    "// localStorage.clear()",
    "const example = \"localStorage.setItem('planner', '{}')\"",
  ]) {
    const bindings = collectScopedStorageKeyBindings(source)
    assert.equal(
      findUnsafeStorageAccess(source, 'candidate.tsx', bindings),
      null,
      source,
    )
  }
})
