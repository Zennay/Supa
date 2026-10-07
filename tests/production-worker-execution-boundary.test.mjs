import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const workerConstructors = new Set(['SharedWorker', 'Worker'])

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

function isBrowserGlobalMember(node, expectedName) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return current.text === expectedName
  }

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

function isNavigatorObject(node) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) return current.text === 'navigator'

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    memberName(current) === 'navigator'
  )
}

function isServiceWorkerObject(node) {
  const current = unwrapExpression(node)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return (
    isNavigatorObject(current.expression) &&
    memberName(current) === 'serviceWorker'
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

function findSecondaryBrowserExecution(source, filename = 'candidate.tsx') {
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

    if (ts.isNewExpression(node)) {
      for (const constructorName of workerConstructors) {
        if (isBrowserGlobalMember(node.expression, constructorName)) {
          finding = {
            kind: constructorName + ' construction',
            text: node.expression.getText(sourceFile),
          }
          return
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)

      if (isBrowserGlobalMember(callee, 'importScripts')) {
        finding = {
          kind: 'worker importScripts call',
          text: callee.getText(sourceFile),
        }
        return
      }

      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        if (
          isServiceWorkerObject(callee.expression) &&
          memberName(callee) === 'register'
        ) {
          finding = {
            kind: 'service-worker registration',
            text: callee.getText(sourceFile),
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

test('production source has no secondary browser execution contexts', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findSecondaryBrowserExecution(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden secondary browser execution: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('worker execution boundary catches direct browser execution primitives', () => {
  for (const source of [
    "new Worker('/worker.js')",
    "new window['Worker']('/worker.js')",
    "new SharedWorker('/shared.js')",
    "new globalThis.SharedWorker('/shared.js')",
    "navigator.serviceWorker.register('/sw.js')",
    "window.navigator['serviceWorker']['register']('/sw.js')",
    "importScripts('/runtime.js')",
    "self['importScripts']('/runtime.js')",
  ]) {
    assert.ok(findSecondaryBrowserExecution(source), source)
  }
})

test('worker execution boundary ignores inert text and unrelated local APIs', () => {
  for (const source of [
    "// new Worker('/example.js')",
    "const example = \"navigator.serviceWorker.register('/example.js')\"",
    "pool.Worker('/local')",
    "new runtime.Worker('/local')",
    "serviceWorker.register('/local')",
    "registry.serviceWorker.register('/local')",
    "loader.importScripts('/local')",
  ]) {
    assert.equal(findSecondaryBrowserExecution(source), null, source)
  }
})
