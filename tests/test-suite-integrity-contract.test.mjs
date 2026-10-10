import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import * as ts from 'typescript'

const testsDir = new URL('./', import.meta.url)
const disabledModes = new Set(['only', 'skip', 'todo'])
const nodeTestExports = new Set(['describe', 'it', 'suite', 'test'])

function propertyName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  return null
}

function elementName(node) {
  if (!node) return null
  const current = unwrapExpression(node)
  return ts.isStringLiteralLike(current) ? current.text : null
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

function nodeTestBindings(sourceFile) {
  const bindings = new Set()
  const namespaceBindings = new Set()

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'node:test'
    ) {
      continue
    }

    const clause = statement.importClause
    if (!clause) continue

    if (clause.name) {
      bindings.add(clause.name.text)
    }

    const namedBindings = clause.namedBindings
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      namespaceBindings.add(namedBindings.name.text)
      continue
    }
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue

    for (const element of namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text
      if (nodeTestExports.has(importedName)) {
        bindings.add(element.name.text)
      }
    }
  }

  return { bindings, namespaceBindings }
}

// Only literal members of an imported node:test namespace are trusted test APIs.
// Do not treat arbitrary objects with a .test property as node:test.
function isNodeTestCallee(callee, bindings, namespaceBindings) {
  const current = unwrapExpression(callee)
  if (ts.isIdentifier(current)) return bindings.has(current.text)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const receiver = unwrapExpression(current.expression)
  const member = ts.isPropertyAccessExpression(current)
    ? current.name.text
    : elementName(current.argumentExpression)
  return (
    ts.isIdentifier(receiver) &&
    namespaceBindings.has(receiver.text) &&
    (nodeTestExports.has(member) || member === 'default')
  )
}

function disablingLiteral(name, initializer) {
  const value = unwrapExpression(initializer)

  if (value.kind === ts.SyntaxKind.TrueKeyword) return true

  return (
    (name === 'skip' || name === 'todo') &&
    ts.isStringLiteralLike(value)
  )
}

function literalDisabledOption(call, sourceFile) {
  for (const argument of call.arguments.slice(0, 2)) {
    const options = unwrapExpression(argument)
    if (!ts.isObjectLiteralExpression(options)) continue

    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property)) continue

      const name = propertyName(property.name)
      if (
        name &&
        disabledModes.has(name) &&
        disablingLiteral(name, property.initializer)
      ) {
        return {
          mode: name,
          text: property.getText(sourceFile),
        }
      }
    }
  }

  return null
}

function findDisabledNodeTests(source, filename = 'candidate.test.mjs') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const { bindings, namespaceBindings } = nodeTestBindings(sourceFile)
  const findings = []

  function record(mode, node) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    findings.push({
      mode,
      line: line + 1,
      text: node.getText(sourceFile),
    })
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)

      if (isNodeTestCallee(callee, bindings, namespaceBindings)) {
        const option = literalDisabledOption(node, sourceFile)
        if (option) record(option.mode, node)
      } else if (
        ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)
      ) {
        const base = unwrapExpression(callee.expression)
        const member = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : elementName(callee.argumentExpression)

        if (
          isNodeTestCallee(base, bindings, namespaceBindings) &&
          member &&
          disabledModes.has(member)
        ) {
          record(member, node)
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

test('disabled-test detector catches node:test skip, todo and focused cases', () => {
  const source = `
    import test, { describe as group, it } from 'node:test'

    test.skip('skipped', () => {})
    test['todo']('todo', () => {})
    it.only('focused', () => {})
    group('disabled options', { skip: true }, () => {})
    test('todo options', { todo: 'pending' }, () => {})
    test('focused options', { only: true }, () => {})
    group({ skip: 'not supported here' }, () => {})
  `

  assert.deepEqual(
    findDisabledNodeTests(source).map(({ mode }) => mode),
    ['skip', 'todo', 'only', 'skip', 'todo', 'only', 'skip'],
  )
})

test('disabled-test detector rejects namespace-imported test methods and options', () => {
  const source = `
    import * as nodeTest from 'node:test'
    nodeTest.test.skip('disabled', () => {})
    nodeTest['it']['only']('focused', () => {})
    nodeTest.describe('todo via options', { todo: 'later' }, () => {})
    nodeTest['test']('skipped via options', { skip: true }, () => {})
    nodeTest.default.todo('todo via default export', () => {})
  `

  assert.deepEqual(
    findDisabledNodeTests(source).map(({ mode }) => mode),
    ['skip', 'only', 'todo', 'skip', 'todo'],
  )
})

test('disabled-test detector ignores inert text and unrelated or dynamic APIs', () => {
  const source = `
    import test from 'node:test'
    import * as nodeTest from 'node:test'

    // test.skip('comment only')
    const example = "test.todo('string only')"
    const mode = 'skip'
    helper.skip('local helper')
    test[mode]('dynamic member', () => {})
    unrelated.test.skip('other library', () => {})
    unrelated['it']('normal', { only: true }, () => {})
    const name = 'test'
    nodeTest[name].skip('dynamic namespace key', () => {})
    nodeTest.test[mode]('dynamic mode', () => {})
    test('ordinary test', () => {})
    test('false literals stay enabled', { skip: false, todo: false, only: false }, () => {})
  `

  assert.deepEqual(findDisabledNodeTests(source), [])
})

test('repository test suite contains no disabled or focused node:test cases', async () => {
  const entries = await readdir(testsDir, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  assert.ok(files.length > 0, 'expected at least one repository test file')

  const violations = []

  for (const filename of files) {
    const source = await readFile(new URL(filename, testsDir), 'utf8')
    for (const finding of findDisabledNodeTests(source, filename)) {
      violations.push(
        filename + ':' + finding.line + ' uses node:test ' + finding.mode +
          ' and would weaken the required regression suite: ' + finding.text,
      )
    }
  }

  assert.deepEqual(violations, [])
})
