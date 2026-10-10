import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)

function scriptKindFor(filename) {
  return path.extname(filename) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
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

function memberName(node) {
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

function isStaticKeyPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text === 'key'
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression)
    return ts.isStringLiteralLike(expression) && expression.text === 'key'
  }
  return false
}

function expressionReferencesIdentifier(expression, identifierName) {
  let found = false

  function visit(node) {
    if (found) return

    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.parameters.some(
        (parameter) =>
          ts.isIdentifier(parameter.name) &&
          parameter.name.text === identifierName,
      )
    ) {
      return
    }

    if (ts.isIdentifier(node) && node.text === identifierName) {
      const parent = node.parent
      const isPropertyName =
        ts.isPropertyAccessExpression(parent) && parent.name === node
      const isObjectPropertyName =
        ts.isPropertyAssignment(parent) &&
        parent.name === node &&
        parent.initializer !== node

      if (!isPropertyName && !isObjectPropertyName) {
        found = true
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(expression)
  return found
}

function findMapIndexKey(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  let finding = null

  function inspectMapCallback(callback, indexName) {
    function visit(node) {
      if (finding) return

      if (
        node !== callback &&
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.parameters.some(
          (parameter) =>
            ts.isIdentifier(parameter.name) &&
            parameter.name.text === indexName,
        )
      ) {
        return
      }

      if (
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'key' &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        expressionReferencesIdentifier(node.initializer.expression, indexName)
      ) {
        finding = {
          indexName,
          text: node.getText(sourceFile),
        }
        return
      }

      // JSX spreads can also supply React's reserved key, e.g.
      // <Row {...{ key: index }} />. Only inspect literal object spreads;
      // never evaluate dynamic objects or guessed aliases.
      if (ts.isJsxSpreadAttribute(node)) {
        const value = unwrapExpression(node.expression)
        if (ts.isObjectLiteralExpression(value)) {
          for (const property of value.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              isStaticKeyPropertyName(property.name) &&
              expressionReferencesIdentifier(property.initializer, indexName)
            ) {
              finding = {
                indexName,
                text: node.getText(sourceFile),
              }
              return
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(callback.body)
  }

  function visit(node) {
    if (finding) return

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)
      const isListMapperCall =
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        (memberName(callee) === 'map' || memberName(callee) === 'flatMap')

      if (isListMapperCall) {
        const callback = node.arguments[0]
        if (
          callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
          callback.parameters.length >= 2
        ) {
          const indexParameter = callback.parameters[1].name
          if (ts.isIdentifier(indexParameter)) {
            inspectMapCallback(callback, indexParameter.text)
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

async function listProductionTsx(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listProductionTsx(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && path.extname(entry.name) === '.tsx') {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('production React list keys stay independent from map position', async () => {
  const files = await listProductionTsx(srcDir)
  assert.ok(files.length > 0, 'expected at least one production TSX file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findMapIndexKey(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' keys a rendered list item using map position: ' +
        (finding?.text ?? 'unknown key'),
    )
  }
})

test('list-key contract catches direct, wrapped and composite map-index keys', () => {
  for (const source of [
    'items.map((item, index) => <Row key={index} item={item} />)',
    'items.map(function (item, position) { return <Row key={(position)} item={item} /> })',
    'items.map((item, offset) => <Row key={offset as number} item={item} />)',
    'items.map((item, index) => <Row key={item.id + ":" + index} item={item} />)',
    'items.map((item, index) => <Row key={`${item.id}-${index}`} item={item} />)',
    'items.map((item, index) => <Row key={String(index)} item={item} />)',
  ]) {
    assert.ok(findMapIndexKey(source), source)
  }
})

test('list-key contract also rejects flatMap-position keys', () => {
  for (const source of [
    'items.flatMap((item, index) => <Row key={index} item={item} />)',
    'items["flatMap"]((item, position) => [<Row {...{ key: position }} />])',
  ]) {
    assert.ok(findMapIndexKey(source), source)
  }
})

test('list-key contract rejects map index supplied through literal JSX key spreads', () => {
  for (const source of [
    'items.map((item, index) => <Row {...{ key: index }} item={item} />)',
    'items.map((item, index) => <Row {...{ ["key"]: item.id + ":" + index }} />)',
    'items.map((item, index) => <Row {...({ key: String(index) })} />)',
  ]) {
    assert.ok(findMapIndexKey(source), source)
  }
})

test('list-key contract preserves stable semantic keys and property names', () => {
  for (const source of [
    'items.map((item, index) => <Row key={item.id} item={item} />)',
    'items.map((item, index) => <Row key={item.index} item={item} />)',
    'items.map((item, index) => <Row key={item.slug + ":" + item.version} item={item} />)',
    'const index = "stable"; const row = <Row key={index} />',
    'items.map((item) => <Row key={item.id} item={item} />)',
    'items["map"]((item, position) => <Row key={item.id} item={item} />)',
    'items.map((item, index) => <Row {...{ key: item.id }} />)',
    'items.map((item, index) => <Row {...{ unrelated: index, key: item.id }} />)',
    'items.map((item, index) => <Row {...props} />)',
    'items.map((item, index) => <Row {...{ ["keyName"]: index }} />)',
    'items.flatMap((item, index) => <Row key={item.id} />)',
  ]) {
    assert.equal(findMapIndexKey(source), null, source)
  }
})

test('list-key contract does not confuse a nested shadowed identifier with the outer map index', () => {
  const source = `
    items.map((item, index) =>
      values.map((index) => <Row key={index.id} item={item} />)
    )
  `

  assert.equal(findMapIndexKey(source), null)
})
