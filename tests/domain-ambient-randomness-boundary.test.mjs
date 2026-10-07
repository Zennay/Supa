import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const domainDir = new URL('../src/domain/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])

function staticName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  return null
}

function accessPath(node) {
  if (ts.isIdentifier(node)) return [node.text]

  if (ts.isPropertyAccessExpression(node)) {
    const base = accessPath(node.expression)
    return base ? [...base, node.name.text] : null
  }

  if (ts.isElementAccessExpression(node)) {
    const base = accessPath(node.expression)
    const name = staticName(node.argumentExpression)
    return base && name ? [...base, name] : null
  }

  return null
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text]
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingNames(element.name) : [],
    )
  }
  return []
}

function statementBindsName(statement, name) {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      bindingNames(declaration.name).includes(name),
    )
  }

  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)) &&
    statement.name
  ) {
    return statement.name.text === name
  }

  if (ts.isImportDeclaration(statement) && statement.importClause) {
    const clause = statement.importClause
    if (clause.name?.text === name) return true
    if (clause.namedBindings) {
      if (
        ts.isNamespaceImport(clause.namedBindings) &&
        clause.namedBindings.name.text === name
      ) {
        return true
      }
      if (
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.some((element) => element.name.text === name)
      ) {
        return true
      }
    }
  }

  return false
}

function scopeBindsName(scope, name) {
  if (
    (ts.isFunctionLike(scope) || ts.isConstructorDeclaration(scope)) &&
    scope.parameters.some((parameter) => bindingNames(parameter.name).includes(name))
  ) {
    return true
  }

  if (ts.isCatchClause(scope) && scope.variableDeclaration) {
    return bindingNames(scope.variableDeclaration.name).includes(name)
  }

  if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
    return scope.statements.some((statement) => statementBindsName(statement, name))
  }

  return false
}

function isLocallyBound(identifier, name) {
  let current = identifier.parent
  while (current) {
    if (scopeBindsName(current, name)) return true
    current = current.parent
  }
  return false
}

function rootIdentifier(node) {
  let current = node
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    current = current.expression
  }
  return ts.isIdentifier(current) ? current : null
}

function forbiddenRandomnessKind(node) {
  if (
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  ) {
    return null
  }

  const pathParts = accessPath(node)
  if (!pathParts) return null

  const directMath = pathParts.length === 2 &&
    pathParts[0] === 'Math' &&
    pathParts[1] === 'random'
  const directCrypto = pathParts.length === 2 &&
    pathParts[0] === 'crypto' &&
    (pathParts[1] === 'randomUUID' || pathParts[1] === 'getRandomValues')

  if (directMath || directCrypto) {
    const root = rootIdentifier(node)
    if (root && isLocallyBound(root, pathParts[0])) return null
    return directMath ? 'Math.random' : `crypto.${pathParts[1]}`
  }

  const rootedMath = pathParts.length === 3 &&
    ['globalThis', 'window', 'self'].includes(pathParts[0]) &&
    pathParts[1] === 'Math' &&
    pathParts[2] === 'random'
  if (rootedMath) return `${pathParts[0]}.Math.random`

  const rootedCrypto = pathParts.length === 3 &&
    ['globalThis', 'window', 'self'].includes(pathParts[0]) &&
    pathParts[1] === 'crypto' &&
    (pathParts[2] === 'randomUUID' || pathParts[2] === 'getRandomValues')
  if (rootedCrypto) return `${pathParts[0]}.crypto.${pathParts[2]}`

  return null
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

function findAmbientRandomness(source, filename = 'candidate.ts') {
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

    const kind = forbiddenRandomnessKind(node)
    if (kind) {
      finding = {
        kind,
        text: node.getText(sourceFile),
      }
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

async function listDomainSources(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listDomainSources(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('financial domain does not depend on ambient randomness', async () => {
  const files = await listDomainSources(domainDir)
  assert.ok(files.length > 0, 'expected at least one domain source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findAmbientRandomness(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains ambient randomness via ' +
        (finding?.kind ?? 'unknown source') + ': ' +
        (finding?.text ?? 'unknown syntax'),
    )
  }
})

test('ambient randomness guard catches direct, computed, aliased-reference and browser-root syntax', () => {
  for (const source of [
    'const pick = Math.random()',
    "const pick = Math['random']",
    'const pick = Math.random',
    'const id = crypto.randomUUID()',
    "const fill = crypto['getRandomValues']",
    'const pick = globalThis.Math.random()',
    "const id = window['crypto'].randomUUID()",
    "const fill = self.crypto['getRandomValues']",
  ]) {
    assert.ok(findAmbientRandomness(source), source)
  }
})

test('ambient randomness guard preserves inert text and locally shadowed names', () => {
  for (const source of [
    "// Math.random() is forbidden in domain code",
    "const example = 'crypto.randomUUID()'",
    'function sample(Math) { return Math.random() }',
    'function sample(crypto) { return crypto.randomUUID() }',
    'const Math = { random: () => 0.5 }; Math.random()',
    'const crypto = { getRandomValues: (value) => value }; crypto.getRandomValues([])',
  ]) {
    assert.equal(findAmbientRandomness(source), null, source)
  }
})
