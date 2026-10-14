import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const prototypeOwners = new Set(['Object', 'Reflect'])

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

function directPropertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  return null
}

function isBrowserRoot(node) {
  const current = unwrapExpression(node)
  return ts.isIdentifier(current) && browserRoots.has(current.text)
}

function isPrototypeOwner(node) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current) && prototypeOwners.has(current.text)) {
    return current.text
  }

  if (
    (ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)) &&
    isBrowserRoot(current.expression)
  ) {
    const name = staticMemberName(current)
    return prototypeOwners.has(name) ? name : null
  }

  return null
}

function setPrototypeOfReference(node) {
  const current = unwrapExpression(node)
  if (
    !ts.isPropertyAccessExpression(current) &&
    !ts.isElementAccessExpression(current)
  ) {
    return null
  }

  if (staticMemberName(current) !== 'setPrototypeOf') return null

  const owner = isPrototypeOwner(current.expression)
  return owner ? owner + '.setPrototypeOf' : null
}

function destructuredSetPrototypeOf(node) {
  if (!ts.isBindingElement(node) || node.dotDotDotToken) return null

  const pattern = node.parent
  if (!ts.isObjectBindingPattern(pattern)) return null

  const declaration = pattern.parent
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) {
    return null
  }

  if (directPropertyName(node.propertyName ?? node.name) !== 'setPrototypeOf') {
    return null
  }

  const owner = isPrototypeOwner(declaration.initializer)
  return owner ? owner + '.setPrototypeOf' : null
}

function isProtoMember(node) {
  const current = unwrapExpression(node)
  return (
    (ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)) &&
    staticMemberName(current) === '__proto__'
  )
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
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

function findPrototypeMutationPrimitive(source, filename = 'candidate.tsx') {
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
      const reference = setPrototypeOfReference(node)
      if (reference) {
        record(reference + ' reference', node)
        return
      }
    }

    if (ts.isBindingElement(node)) {
      const reference = destructuredSetPrototypeOf(node)
      if (reference) {
        record(reference + ' destructuring', node)
        return
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      isProtoMember(node.left)
    ) {
      record('__proto__ assignment', node)
      return
    }

    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isProtoMember(node.operand)
    ) {
      record('__proto__ update', node)
      return
    }

    if (
      ts.isPropertyAssignment(node) &&
      directPropertyName(node.name) === '__proto__'
    ) {
      record('__proto__ object-literal setter', node)
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

test('prototype-mutation guard catches setPrototypeOf references', () => {
  for (const source of [
    'Object.setPrototypeOf(target, prototype)',
    'Reflect.setPrototypeOf(target, prototype)',
    'const mutate = Object.setPrototypeOf',
    "const mutate = globalThis.Object['setPrototypeOf']",
    'const { setPrototypeOf: mutate } = Reflect',
    "const { 'setPrototypeOf': mutate } = window.Object",
  ]) {
    assert.ok(findPrototypeMutationPrimitive(source), source)
  }
})

test('prototype-mutation guard catches legacy __proto__ mutation forms', () => {
  for (const source of [
    'target.__proto__ = prototype',
    "target['__proto__'] ??= prototype",
    'target.__proto__++',
    'const value = { __proto__: prototype }',
    "const value = { '__proto__': prototype }",
  ]) {
    assert.ok(findPrototypeMutationPrimitive(source), source)
  }
})

test('prototype-mutation guard preserves non-mutating prototype patterns and inert text', () => {
  for (const source of [
    'const dictionary = Object.create(null)',
    'class Child extends Parent {}',
    'const render = Widget.prototype.render',
    'helper.setPrototypeOf(target, prototype)',
    "const computed = { ['__proto__']: prototype }",
    "// Object.setPrototypeOf(target, prototype)",
    "const example = 'target.__proto__ = prototype'",
  ]) {
    assert.equal(findPrototypeMutationPrimitive(source), null, source)
  }
})

test('production source has no prototype-mutation primitives', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findPrototypeMutationPrimitive(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden prototype mutation: ' +
        (finding?.kind ?? 'unknown primitive') + ' at line ' +
        (finding?.line ?? '?') + ' via ' + (finding?.text ?? 'unknown source'),
    )
  }
})
