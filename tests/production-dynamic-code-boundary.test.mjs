import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const dynamicGlobals = new Set(['eval', 'Function'])
const stringTimerGlobals = new Set(['setInterval', 'setTimeout'])

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

  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return unwrapExpression(current.right)
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

function isStaticString(node) {
  if (!node) return false
  const current = unwrapExpression(node)
  return ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)
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

function findDynamicCodeExecution(source, filename = 'candidate.tsx') {
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

    if (ts.isVariableDeclaration(node) && node.initializer) {
      for (const globalName of dynamicGlobals) {
        if (isBrowserGlobalMember(node.initializer, globalName)) {
          finding = {
            kind: globalName + ' capability alias',
            text: node.getText(sourceFile),
          }
          return
        }
      }
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      for (const globalName of dynamicGlobals) {
        if (isBrowserGlobalMember(node.expression, globalName)) {
          finding = {
            kind: globalName + ' runtime code generation',
            text: node.expression.getText(sourceFile),
          }
          return
        }
      }

      if (ts.isCallExpression(node) && isStaticString(node.arguments[0])) {
        for (const timerName of stringTimerGlobals) {
          if (isBrowserGlobalMember(node.expression, timerName)) {
            finding = {
              kind: timerName + ' string execution',
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

test('production source contains no direct runtime code generation', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findDynamicCodeExecution(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden dynamic code execution: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('dynamic-code guard catches direct eval, Function constructors and string timers', () => {
  for (const source of [
    "eval('globalThis.compromised = true')",
    "(0, eval)('globalThis.compromised = true')",
    "globalThis['eval']('globalThis.compromised = true')",
    "window.eval('globalThis.compromised = true')",
    "Function('return globalThis')()",
    "new Function('return globalThis')",
    "new self['Function']('return globalThis')",
    "const execute = eval",
    "const execute = (window['eval'] as typeof eval)",
    "const Compiler = globalThis.Function",
    "const Compiler = (self['Function'])",
    "setTimeout('globalThis.compromised = true', 0)",
    "window['setInterval'](`globalThis.compromised = true`, 1000)",
  ]) {
    assert.ok(findDynamicCodeExecution(source), source)
  }
})

test('dynamic-code guard ignores inert text, callback timers and unrelated methods', () => {
  for (const source of [
    "// eval('example')",
    "const example = \"new Function('return 1')\"",
    "setTimeout(() => refresh(), 0)",
    "window.setInterval(() => refresh(), 1000)",
    "sandbox.eval('expression')",
    "factory.Function('template')",
    "const execute = sandbox.eval",
    "const Compiler = factory.Function",
    "const schedule = setTimeout",
    "const FunctionName = 'safe label'",
  ]) {
    assert.equal(findDynamicCodeExecution(source), null, source)
  }
})
