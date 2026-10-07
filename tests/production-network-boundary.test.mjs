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

function bindingIdentifierNames(name, names = []) {
  if (!name) return names

  if (ts.isIdentifier(name)) {
    names.push(name.text)
    return names
  }

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        bindingIdentifierNames(element.name, names)
      }
    }
  }

  return names
}

function nearestBindingScope(node, blockScoped = true) {
  let current = node.parent

  while (current) {
    if (
      ts.isSourceFile(current) ||
      ts.isFunctionLike(current) ||
      (blockScoped && (
        ts.isBlock(current) ||
        ts.isModuleBlock(current) ||
        ts.isCatchClause(current)
      ))
    ) {
      return current
    }

    current = current.parent
  }

  return null
}

function collectLocalBindingScopes(sourceFile) {
  const scopesByName = new Map()

  function register(scope, name) {
    if (!scope) return

    for (const identifier of bindingIdentifierNames(name)) {
      const scopes = scopesByName.get(identifier) ?? new Set()
      scopes.add(scope)
      scopesByName.set(identifier, scopes)
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      register(sourceFile, node.importClause.name)

      const bindings = node.importClause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        register(sourceFile, bindings.name)
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) register(sourceFile, element.name)
      }
    }

    if (ts.isParameter(node)) {
      register(nearestBindingScope(node, false), node.name)
    }

    if (ts.isVariableDeclaration(node) && !ts.isCatchClause(node.parent)) {
      const declarationList = node.parent
      const blockScoped = ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0
      register(nearestBindingScope(node, blockScoped), node.name)
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    ) {
      register(nearestBindingScope(node, true), node.name)
    }

    if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name
    ) {
      register(node, node.name)
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      register(node, node.variableDeclaration.name)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return scopesByName
}

function isLocallyBoundIdentifier(node, scopesByName) {
  if (!ts.isIdentifier(node)) return false

  const scopes = scopesByName.get(node.text)
  if (!scopes) return false

  let current = node.parent
  while (current) {
    if (scopes.has(current)) return true
    current = current.parent
  }

  return false
}

function isBrowserGlobalMember(node, expectedName, bindings) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return (
      current.text === expectedName &&
      !isLocallyBoundIdentifier(current, bindings.localBindings)
    )
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return (
    isBrowserRoot(current.expression, bindings) &&
    memberName(current) === expectedName
  )
}

function isBrowserRoot(node, bindings) {
  const current = unwrapExpression(node)
  if (!ts.isIdentifier(current)) return false

  if (browserRoots.has(current.text)) {
    return !isLocallyBoundIdentifier(current, bindings.localBindings)
  }

  return bindings.rootAliases.has(current.text)
}

function isNavigatorObject(node, bindings) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) {
    if (current.text === 'navigator') {
      return !isLocallyBoundIdentifier(current, bindings.localBindings)
    }

    return bindings.navigatorAliases.has(current.text)
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return (
    isBrowserRoot(current.expression, bindings) &&
    memberName(current) === 'navigator'
  )
}

function networkReferenceName(node, bindings) {
  const current = unwrapExpression(node)

  if (isBrowserGlobalMember(current, 'fetch', bindings)) return 'fetch'

  for (const constructorName of networkConstructors) {
    if (isBrowserGlobalMember(current, constructorName, bindings)) {
      return constructorName
    }
  }

  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (
      memberName(current) === 'sendBeacon' &&
      isNavigatorObject(current.expression, bindings)
    ) {
      return 'navigator.sendBeacon'
    }
  }

  return null
}

function bindingElementNetworkReference(node, bindings) {
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
    isBrowserRoot(source, bindings) &&
    (key === 'fetch' || networkConstructors.has(key))
  ) {
    return key
  }

  if (
    key === 'sendBeacon' &&
    isNavigatorObject(source, bindings)
  ) {
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

function collectBrowserAliases(sourceFile, localBindings) {
  const rootAliases = new Set(browserRoots)
  const navigatorAliases = new Set()
  const bindings = { rootAliases, navigatorAliases, localBindings }
  let changed = true

  while (changed) {
    changed = false

    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const initializer = unwrapExpression(node.initializer)

        if (ts.isIdentifier(node.name)) {
          const alias = node.name.text

          if (
            !rootAliases.has(alias) &&
            isBrowserRoot(initializer, bindings)
          ) {
            rootAliases.add(alias)
            changed = true
          }

          if (
            !navigatorAliases.has(alias) &&
            isNavigatorObject(initializer, bindings)
          ) {
            navigatorAliases.add(alias)
            changed = true
          }
        } else if (
          ts.isObjectBindingPattern(node.name) &&
          isBrowserRoot(initializer, bindings)
        ) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue
            const sourceName = staticName(element.propertyName) ?? element.name.text
            if (
              sourceName === 'navigator' &&
              !navigatorAliases.has(element.name.text)
            ) {
              navigatorAliases.add(element.name.text)
              changed = true
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return bindings
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

  const localBindings = collectLocalBindingScopes(sourceFile)
  const bindings = collectBrowserAliases(sourceFile, localBindings)
  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isCallExpression(node)) {
      if (isBrowserGlobalMember(node.expression, 'fetch', bindings)) {
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
          isNavigatorObject(callee.expression, bindings)
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
        if (
          isBrowserGlobalMember(node.expression, constructorName, bindings)
        ) {
          finding = {
            kind: constructorName + ' construction',
            text: node.expression.getText(sourceFile),
          }
          return
        }
      }
    }

    if (ts.isBindingElement(node)) {
      const referenceName = bindingElementNetworkReference(node, bindings)
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
      const referenceName = networkReferenceName(node, bindings)
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
    "const root = window; const request = root.fetch",
    "const root = globalThis; const Socket = root.WebSocket",
    "const root = self; const next = root; const Xhr = next.XMLHttpRequest",
    "const nav = navigator; const beacon = nav.sendBeacon",
    "const root = window; const nav = root.navigator; const beacon = nav.sendBeacon",
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
    "const root = window; const { fetch: request } = root",
    "const root = self; const { WebSocket: Socket } = root",
    "const { navigator: nav } = globalThis; const { sendBeacon: beacon } = nav",
  ]) {
    assert.ok(findDirectProductionNetworkAccess(source), source)
  }
})

test('network boundary respects locally bound browser-global names', () => {
  for (const source of [
    "const fetch = api.fetch; fetch('/local')",
    "function request(fetch) { fetch('/local') }",
    "import { fetch } from './client'; fetch('/local')",
    "class WebSocket {}; new WebSocket('/local')",
    "function connect(WebSocket) { new WebSocket('/local') }",
    "import WebSocket from './socket'; new WebSocket('/local')",
    "const navigator = telemetry; navigator.sendBeacon('/local')",
    "function ping(navigator) { navigator.sendBeacon('/local') }",
    "const window = appWindow; window.fetch('/local')",
    "function run(globalThis) { globalThis.fetch('/local') }",
    "try {} catch (navigator) { navigator.sendBeacon('/local') }",
  ]) {
    assert.equal(findDirectProductionNetworkAccess(source), null, source)
  }
})

test('network boundary keeps local shadowing scoped', () => {
  for (const source of [
    "{ const fetch = api.fetch; fetch('/local') }\nfetch('/api')",
    "function local(window) { window.fetch('/local') }\nwindow.fetch('/api')",
    "try {} catch (navigator) { navigator.sendBeacon('/local') }\nnavigator.sendBeacon('/api')",
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
    'const root = app.window; const request = root.fetch',
    'const nav = app.navigator; const beacon = nav.sendBeacon',
    'const { navigator: nav } = app; const beacon = nav.sendBeacon',
    'const fetch = 1',
    'class WebSocket {}',
    "const fetchCount = 1",
  ]) {
    assert.equal(findDirectProductionNetworkAccess(source), null, source)
  }
})
