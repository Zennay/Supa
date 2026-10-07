import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const locationMethods = new Set(['assign', 'replace'])

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

function isBrowserRoot(node) {
  const current = unwrapExpression(node)
  return ts.isIdentifier(current) && browserRoots.has(current.text)
}

function isBrowserLocation(node) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) return current.text === 'location'

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return (
    isBrowserRoot(current.expression) &&
    memberName(current) === 'location'
  )
}

function isBrowserOpen(node) {
  const current = unwrapExpression(node)

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return isBrowserRoot(current.expression) && memberName(current) === 'open'
}

function isLocationHref(node) {
  const current = unwrapExpression(node)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return isBrowserLocation(current.expression) && memberName(current) === 'href'
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

function isNavigationAssignment(node) {
  if (!ts.isBinaryExpression(node)) return false

  if (
    node.operatorToken.kind !== ts.SyntaxKind.EqualsToken &&
    node.operatorToken.kind !== ts.SyntaxKind.PlusEqualsToken
  ) {
    return false
  }

  return isBrowserLocation(node.left) || isLocationHref(node.left)
}

function findImperativeBrowserNavigation(source, filename = 'candidate.tsx') {
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

      if (isBrowserOpen(callee)) {
        finding = {
          kind: 'new browsing context',
          text: callee.getText(sourceFile),
        }
        return
      }

      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        if (
          isBrowserLocation(callee.expression) &&
          locationMethods.has(memberName(callee))
        ) {
          finding = {
            kind: 'imperative document navigation',
            text: callee.getText(sourceFile),
          }
          return
        }
      }
    }

    if (isNavigationAssignment(node)) {
      finding = {
        kind: 'browser location assignment',
        text: node.left.getText(sourceFile),
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

test('production source has no imperative browser navigation escapes', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findImperativeBrowserNavigation(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden imperative browser navigation: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('navigation boundary catches direct browser navigation primitives', () => {
  for (const source of [
    "window.open('https://example.test')",
    "self['open']('/elsewhere')",
    "globalThis.open('/elsewhere')",
    "location.assign('/elsewhere')",
    "window.location.replace('/elsewhere')",
    "self['location']['assign']('/elsewhere')",
    "location.href = '/elsewhere'",
    "window.location = '/elsewhere'",
    "globalThis['location']['href'] += '?next=1'",
  ]) {
    assert.ok(findImperativeBrowserNavigation(source), source)
  }
})

test('navigation boundary preserves inert text and app-local navigation abstractions', () => {
  for (const source of [
    "// window.open('https://example.test')",
    "const example = \"location.assign('/example')\"",
    "router.open('/planner')",
    "navigation.assign('/planner')",
    "history.pushState({}, '', '/planner')",
    "history.replaceState({}, '', '/planner')",
    "const open = () => {}; open('/planner')",
    "const href = '/planner'",
  ]) {
    assert.equal(findImperativeBrowserNavigation(source), null, source)
  }
})
