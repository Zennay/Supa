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

function networkReferenceName(node) {
  const current = unwrapExpression(node)

  if (isBrowserGlobalMember(current, 'fetch')) return 'fetch'

  for (const constructorName of networkConstructors) {
    if (isBrowserGlobalMember(current, constructorName)) {
      return constructorName
    }
  }

  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (
      memberName(current) === 'sendBeacon' &&
      isNavigatorObject(current.expression)
    ) {
      return 'navigator.sendBeacon'
    }
  }

  return null
}

function isBrowserRoot(node) {
  const current = unwrapExpression(node)
  return ts.isIdentifier(current) && browserRoots.has(current.text)
}

function bindingElementNetworkReference(node) {
  if (!ts.isBindingElement(node) || node.dotDotDotToken) return null

  const pattern = node.parent
  if (!ts.isObjectBindingPattern(pattern)) return null

  const declaration = pattern.parent
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) {
    return null
  }

  const key = staticName(node.propertyName ?? node.name)
  if (!key) return null

  const source = unwrapExpression(declaration.initializer)
  if (
    isBrowserRoot(source) &&
    (key === 'fetch' || networkConstructors.has(key))
  ) {
    return key
  }

  if (key === 'sendBeacon' && isNavigatorObject(source)) {
    return 'navigator.sendBeacon'
  }

  return null
}

function isSyntaxName(node) {
  const parent = node.parent
  if (!parent) return false

  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isClassExpression(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) &&
      (parent.name === node || parent.propertyName === node))
  )
}

function isDirectNetworkInvocationTarget(node) {
  const parent = node.parent
  if (!parent) return false

  return (
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      unwrapExpression(parent.expression) === node)
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

    if (ts.isBindingElement(node)) {
      const referenceName = bindingElementNetworkReference(node)
      if (referenceName) {
        finding = {
          kind: referenceName + ' destructured reference',
          text: node.getText(sourceFile),
        }
        return
      }
    }

    if (
      (ts.isIdentifier(node) ||
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      !isSyntaxName(node) &&
      !isDirectNetworkInvocationTarget(node)
    ) {
      const referenceName = networkReferenceName(node)
      if (referenceName) {
        finding = {
          kind: referenceName + ' detached reference',
          text: node.getText(sourceFile),
        }
        return
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

test('network boundary catches detached browser networking references', () => {
  for (const source of [
    'const request = fetch',
    "const request = window['fetch']",
    'const Socket = globalThis.WebSocket',
    'const Xhr = XMLHttpRequest',
    'const stream = self.WebSocketStream',
    'const transport = window.WebTransport',
    'const peer = RTCPeerConnection',
    'const events = globalThis.EventSource',
    'const beacon = navigator.sendBeacon',
    "const beacon = window.navigator['sendBeacon']",
  ]) {
    assert.ok(findDirectProductionNetworkAccess(source), source)
  }
})

test('network boundary binds destructured references to browser globals', () => {
  for (const source of [
    'const { fetch: request } = window',
    'const { fetch } = globalThis',
    'const { WebSocket: Socket } = self',
    'const { XMLHttpRequest: Xhr } = window',
    'const { sendBeacon: beacon } = navigator',
    "const { ['sendBeacon']: beacon } = globalThis.navigator",
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
    'const request = api.fetch',
    'const Socket = transport.WebSocket',
    'const beacon = telemetry.sendBeacon',
    'const { fetch: request } = api',
    'const { WebSocket: Socket } = transport',
    'const { sendBeacon: beacon } = telemetry',
    "const config = { fetch: 'local', WebSocket: 'local' }",
    'const fetch = 1',
    'class WebSocket {}',
    "const fetchCount = 1",
  ]) {
    assert.equal(findDirectProductionNetworkAccess(source), null, source)
  }
})
