import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])

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

function isGlobalConsoleObject(node) {
  if (ts.isIdentifier(node)) return node.text === 'console'

  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return (
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'globalThis' &&
      memberName(node) === 'console'
    )
  }

  return false
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

function findForbiddenProductionDiagnostic(source, filename = 'candidate.tsx') {
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

    if (ts.isDebuggerStatement(node)) {
      finding = {
        kind: 'debugger statement',
        text: node.getText(sourceFile),
      }
      return
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (isGlobalConsoleObject(node) || isGlobalConsoleObject(node.expression)) {
        finding = {
          kind: 'console access',
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

test('production source contains no console or debugger statements', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findForbiddenProductionDiagnostic(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains a forbidden ' +
        (finding?.kind ?? 'production diagnostic') + ': ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('production diagnostic guard catches executable console and debugger syntax', () => {
  for (const source of [
    "console.log('debug')",
    "console['error']('debug')",
    "globalThis.console.warn('debug')",
    "globalThis['console']['log']('debug')",
    'const emit = console.info',
    'const globalConsole = globalThis.console',
    'debugger;',
  ]) {
    assert.ok(findForbiddenProductionDiagnostic(source), source)
  }
})

test('production diagnostic guard ignores comments, strings and unrelated loggers', () => {
  for (const source of [
    "// console.log('example')",
    "const example = \"debugger; console.error('example')\"",
    "const logger = { console: { log() {} } }; logger.console.log()",
    "const consoleLike = { log() {} }; consoleLike.log('ok')",
  ]) {
    assert.equal(findForbiddenProductionDiagnostic(source), null, source)
  }
})
