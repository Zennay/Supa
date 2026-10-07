import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const testsDir = new URL('./', import.meta.url)
const disabledModes = new Set(['only', 'skip', 'todo'])
const nodeTestExports = new Set(['describe', 'it', 'suite', 'test'])

function staticName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
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

function nodeTestBindings(sourceFile) {
  const bindings = new Set()

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
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue

    for (const element of namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text
      if (nodeTestExports.has(importedName)) {
        bindings.add(element.name.text)
      }
    }
  }

  return bindings
}

function literalDisabledOption(call, sourceFile) {
  if (call.arguments.length < 2) return null

  const options = unwrapExpression(call.arguments[1])
  if (!ts.isObjectLiteralExpression(options)) return null

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue

    const name = staticName(property.name)
    if (!name || !disabledModes.has(name)) continue

    const value = unwrapExpression(property.initializer)
    if (value.kind === ts.SyntaxKind.TrueKeyword) {
      return {
        mode: name,
        text: property.getText(sourceFile),
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
  const bindings = nodeTestBindings(sourceFile)
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

      if (ts.isIdentifier(callee) && bindings.has(callee.text)) {
        const option = literalDisabledOption(node, sourceFile)
        if (option) record(option.mode, node)
      } else if (
        ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)
      ) {
        const base = unwrapExpression(callee.expression)
        const member = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : staticName(callee.argumentExpression)

        if (
          ts.isIdentifier(base) &&
          bindings.has(base.text) &&
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
    test('todo options', { todo: true }, () => {})
    test('focused options', { only: true }, () => {})
  `

  assert.deepEqual(
    findDisabledNodeTests(source).map(({ mode }) => mode),
    ['skip', 'todo', 'only', 'skip', 'todo', 'only'],
  )
})

test('disabled-test detector ignores inert text and unrelated local APIs', () => {
  const source = `
    import test from 'node:test'

    // test.skip('comment only')
    const example = "test.todo('string only')"
    helper.skip('local helper')
    test('ordinary test', () => {})
    test('false literal stays enabled', { skip: false }, () => {})
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
