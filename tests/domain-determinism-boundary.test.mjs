import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const sourceRoots = [
  { label: 'src/data', url: new URL('../src/data/', import.meta.url) },
  { label: 'src/domain', url: new URL('../src/domain/', import.meta.url) },
]
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])

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

function staticMemberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) {
    const argument = unwrapExpression(node.argumentExpression)
    return ts.isStringLiteralLike(argument) ? argument.text : null
  }
  return null
}

function isBrowserRoot(node) {
  const current = unwrapExpression(node)
  return ts.isIdentifier(current) && browserRoots.has(current.text)
}

function isGlobalObject(node, name) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) return current.text === name

  return (
    (ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)) &&
    isBrowserRoot(current.expression) &&
    staticMemberName(current) === name
  )
}

function globalMethodReference(node, ownerName, methodNames) {
  const current = unwrapExpression(node)
  if (
    !ts.isPropertyAccessExpression(current) &&
    !ts.isElementAccessExpression(current)
  ) {
    return null
  }

  const method = staticMemberName(current)
  if (!method || !methodNames.has(method)) return null
  if (!isGlobalObject(current.expression, ownerName)) return null

  return ownerName + '.' + method
}

function temporalNowReference(node) {
  const current = unwrapExpression(node)
  if (
    !ts.isPropertyAccessExpression(current) &&
    !ts.isElementAccessExpression(current)
  ) {
    return false
  }

  return (
    staticMemberName(current) === 'Now' &&
    isGlobalObject(current.expression, 'Temporal')
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

function findImplicitNondeterminism(source, filename = 'candidate.ts') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  let finding = null

  function record(kind, node) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    finding = {
      kind,
      line: line + 1,
      text: node.getText(sourceFile),
    }
  }

  function visit(node) {
    if (finding) return

    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const timeReference =
        globalMethodReference(node, 'Date', new Set(['now'])) ||
        globalMethodReference(node, 'performance', new Set(['now']))

      if (timeReference) {
        record(timeReference + ' reference', node)
        return
      }

      const randomReference =
        globalMethodReference(node, 'Math', new Set(['random'])) ||
        globalMethodReference(
          node,
          'crypto',
          new Set(['getRandomValues', 'randomUUID']),
        )

      if (randomReference) {
        record(randomReference + ' reference', node)
        return
      }

      if (temporalNowReference(node)) {
        record('Temporal.Now reference', node)
        return
      }
    }

    if (
      ts.isNewExpression(node) &&
      node.arguments?.length === 0 &&
      isGlobalObject(node.expression, 'Date')
    ) {
      record('zero-argument Date construction', node)
      return
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      isGlobalObject(node.expression, 'Date')
    ) {
      record('zero-argument Date call', node)
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

async function listSources(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listSources(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('determinism guard catches implicit current-time reads', () => {
  for (const source of [
    'const now = Date.now()',
    'const now = globalThis.Date.now',
    'const now = performance.now()',
    "const now = window.performance['now']",
    'const now = new Date()',
    'const now = Date()',
    'const instant = Temporal.Now.instant()',
    "const instant = self.Temporal['Now'].instant()",
  ]) {
    assert.ok(findImplicitNondeterminism(source), source)
  }
})

test('determinism guard catches randomness and entropy reads', () => {
  for (const source of [
    'const value = Math.random()',
    "const random = globalThis.Math['random']",
    'const id = crypto.randomUUID()',
    "const fill = window.crypto['getRandomValues']",
  ]) {
    assert.ok(findImplicitNondeterminism(source), source)
  }
})

test('determinism guard preserves explicit time inputs and unrelated APIs', () => {
  for (const source of [
    "const millis = Date.parse(input)",
    'const date = new Date(timestamp)',
    'const rounded = Math.round(value)',
    'const value = sampler.random()',
    'const id = client.randomUUID()',
    'const now = clock.now()',
    "const example = 'Math.random()'",
    '// Date.now()',
  ]) {
    assert.equal(findImplicitNondeterminism(source), null, source)
  }
})

test('domain and data source stay free of implicit time and randomness', async () => {
  for (const root of sourceRoots) {
    const files = await listSources(root.url)
    assert.ok(files.length > 0, 'expected source files under ' + root.label)

    for (const file of files) {
      const source = await readFile(file.url, 'utf8')
      const finding = findImplicitNondeterminism(
        source,
        path.join(root.label, file.relativePath),
      )

      assert.equal(
        finding,
        null,
        path.join(root.label, file.relativePath) +
          ' contains implicit nondeterminism: ' +
          (finding?.kind ?? 'unknown primitive') + ' at line ' +
          (finding?.line ?? '?') + ' via ' +
          (finding?.text ?? 'unknown source'),
      )
    }
  }
})
