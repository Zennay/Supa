import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const networkConstructors = new Set([
  'EventSource',
  'RTCPeerConnection',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'XMLHttpRequest',
])

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

function findDirectProductionNetworkAccess(source, filename = 'candidate.tsx') {
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
      if (isBrowserGlobalMember(node.expression, 'fetch')) {
        finding = {
          kind: 'fetch call',
          text: node.expression.getText(sourceFile),
        }
        return
      }

      const callee = unwrapExpression(node.expression)
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        if (
          memberName(callee) === 'sendBeacon' &&
          isNavigatorObject(callee.expression)
        ) {
          finding = {
            kind: 'sendBeacon call',
            text: callee.getText(sourceFile),
          }
          return
        }
      }
    }

    if (ts.isNewExpression(node)) {
      for (const constructorName of networkConstructors) {
        if (isBrowserGlobalMember(node.expression, constructorName)) {
          finding = {
            kind: constructorName + ' construction',
            text: node.expression.getText(sourceFile),
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

test('production source has no direct browser network access', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findDirectProductionNetworkAccess(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden direct production network access: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('network boundary catches direct browser networking primitives', () => {
  for (const source of [
    "fetch('/api')",
    "window.fetch('/api')",
    "self['fetch']('/api')",
    "globalThis.fetch('/api')",
    "new XMLHttpRequest()",
    "new window['XMLHttpRequest']()",
    "new WebSocket('wss://example.test')",
    "new globalThis.EventSource('/events')",
    "navigator.sendBeacon('/telemetry', 'x')",
    "globalThis.navigator['sendBeacon']('/telemetry', 'x')",
  ]) {
    assert.ok(findDirectProductionNetworkAccess(source), source)
  }
})

test('network boundary ignores comments, strings and unrelated object methods', () => {
  for (const source of [
    "// fetch('/example')",
    "const example = \"new WebSocket('wss://example.test')\"",
    "api.fetch('/local-abstraction')",
    "client.XMLHttpRequest()",
    "telemetry.sendBeacon('/local-abstraction')",
    "const fetchCount = 1",
  ]) {
    assert.equal(findDirectProductionNetworkAccess(source), null, source)
  }
})
