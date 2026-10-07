import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])

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
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text
  }
  return null
}

function isIdentifierReference(node) {
  const parent = node.parent
  if (!parent) return true

  if (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name === node) ||
    (ts.isTypeReferenceNode(parent) && parent.typeName === node)
  ) {
    return false
  }

  return true
}

function findNodeRuntimeUsage(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  let finding = null

  function record(kind, node) {
    finding = {
      kind,
      text: node.getText(sourceFile),
    }
  }

  function visit(node) {
    if (finding) return

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('node:')
    ) {
      record('Node builtin module import', node.moduleSpecifier)
      return
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)

      if (
        callee.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments[0].text.startsWith('node:')
      ) {
        record('Node builtin dynamic import', node)
        return
      }

      if (ts.isIdentifier(callee) && callee.text === 'require') {
        record('CommonJS require call', node)
        return
      }

      if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        ts.isIdentifier(unwrapExpression(callee.expression)) &&
        unwrapExpression(callee.expression).text === 'module' &&
        staticMemberName(callee) === 'require'
      ) {
        record('CommonJS module.require call', node)
        return
      }

      if (ts.isIdentifier(callee) && callee.text === 'Buffer') {
        record('Node Buffer call', node)
        return
      }
    }

    if (ts.isNewExpression(node)) {
      const callee = unwrapExpression(node.expression)
      if (ts.isIdentifier(callee) && callee.text === 'Buffer') {
        record('Node Buffer construction', node)
        return
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = unwrapExpression(node.expression)
      const member = staticMemberName(node)

      if (ts.isIdentifier(base) && base.text === 'process') {
        record('Node process reference', node)
        return
      }
      if (ts.isIdentifier(base) && base.text === 'Buffer') {
        record('Node Buffer reference', node)
        return
      }
      if (
        ts.isIdentifier(base) &&
        browserRoots.has(base.text) &&
        (member === 'process' || member === 'Buffer')
      ) {
        record('browser-root Node runtime reference', node)
        return
      }
    }

    if (ts.isIdentifier(node) && isIdentifierReference(node)) {
      if (node.text === 'process' || node.text === 'Buffer') {
        record('detached Node runtime global reference', node)
        return
      }
      if (node.text === '__dirname' || node.text === '__filename') {
        record('Node path global reference', node)
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

test('browser production source does not depend on Node runtime globals', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findNodeRuntimeUsage(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains Node-only runtime usage: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('Node-runtime boundary rejects browser-incompatible production primitives', () => {
  for (const source of [
    "import { readFile } from 'node:fs/promises'",
    "export { join } from 'node:path'",
    "const fs = await import('node:fs')",
    "process.env.SUPA_TOKEN",
    "process['argv'][0]",
    "const runtimeProcess = process",
    "window.process.env.SUPA_TOKEN",
    "Buffer.from('abc')",
    "const RuntimeBuffer = Buffer",
    "globalThis['Buffer'].from('abc')",
    "new Buffer(16)",
    "require('node:path')",
    "module['require']('node:fs')",
    'const here = __dirname',
    'const file = __filename',
  ]) {
    assert.ok(findNodeRuntimeUsage(source), source)
  }
})

test('Node-runtime boundary preserves browser code, local properties and inert text', () => {
  for (const source of [
    "const env = runtime.process.env",
    "const encoded = runtime.Buffer.from('abc')",
    "const dirname = config.__dirname",
    "const filename = config.__filename",
    "const requireResult = loader.require('feature')",
    "const text = \"process.env.SUPA_TOKEN\"",
    "// Buffer.from('abc')",
    "const processLabel = 'browser'",
  ]) {
    assert.equal(findNodeRuntimeUsage(source), null, source)
  }
})
