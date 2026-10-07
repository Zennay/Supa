import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)

function parseSource(source, filename = 'candidate.tsx') {
  return ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
}

function attributeByName(attributes, expectedName) {
  return attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === expectedName,
  )
}

function staticNumberFromAttribute(attribute) {
  if (!attribute?.initializer) return null

  if (ts.isStringLiteral(attribute.initializer)) {
    const value = Number(attribute.initializer.text)
    return Number.isFinite(value) ? value : null
  }

  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return null
  }

  let expression = attribute.initializer.expression
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression
  }

  if (ts.isNumericLiteral(expression)) return Number(expression.text)

  if (
    ts.isPrefixUnaryExpression(expression) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const value = Number(expression.operand.text)
    if (expression.operator === ts.SyntaxKind.MinusToken) return -value
    if (expression.operator === ts.SyntaxKind.PlusToken) return value
  }

  return null
}

function staticBooleanFromAttribute(attribute) {
  if (!attribute) return null
  if (!attribute.initializer) return true

  if (ts.isStringLiteral(attribute.initializer)) {
    const value = attribute.initializer.text.trim().toLowerCase()
    if (value === 'true') return true
    if (value === 'false') return false
    return null
  }

  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return null
  }

  const expression = attribute.initializer.expression
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
  return null
}

function hasStaticHref(attributes) {
  const href = attributeByName(attributes, 'href')
  if (!href?.initializer) return false

  if (ts.isStringLiteral(href.initializer)) return true
  if (!ts.isJsxExpression(href.initializer) || !href.initializer.expression) {
    return false
  }

  return (
    ts.isStringLiteralLike(href.initializer.expression) ||
    ts.isNoSubstitutionTemplateLiteral(href.initializer.expression)
  )
}

function intrinsicTagName(node) {
  const tagName = node.tagName
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text)
    ? tagName.text
    : null
}

function findFocusAccessibilityEscapeHatch(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  let finding = null

  function inspectOpeningElement(node) {
    if (finding) return

    const tabIndex = attributeByName(node.attributes, 'tabIndex')
    const staticTabIndex = staticNumberFromAttribute(tabIndex)
    if (staticTabIndex !== null && staticTabIndex > 0) {
      finding = {
        kind: 'positive tabIndex',
        text: node.getText(sourceFile),
      }
      return
    }

    const autoFocus = attributeByName(node.attributes, 'autoFocus')
    if (autoFocus) {
      finding = {
        kind: 'autoFocus',
        text: node.getText(sourceFile),
      }
      return
    }

    const ariaHidden = attributeByName(node.attributes, 'aria-hidden')
    if (staticBooleanFromAttribute(ariaHidden) !== true) return

    const tagName = intrinsicTagName(node)
    const alwaysInteractive = new Set(['button', 'input', 'select', 'textarea'])
    const isInteractive =
      (tagName !== null && alwaysInteractive.has(tagName)) ||
      (tagName === 'a' && hasStaticHref(node.attributes))

    if (isInteractive) {
      finding = {
        kind: 'aria-hidden interactive element',
        text: node.getText(sourceFile),
      }
    }
  }

  function visit(node) {
    if (finding) return

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      inspectOpeningElement(node)
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

test('production TSX avoids keyboard and accessibility escape hatches', async () => {
  const files = await listProductionTsx(srcDir)
  assert.ok(files.length > 0, 'expected at least one production TSX file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findFocusAccessibilityEscapeHatch(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains ' +
        (finding?.kind ?? 'an unknown accessibility escape hatch') +
        ' via ' + (finding?.text ?? 'unknown source'),
    )
  }
})

test('focus accessibility guard rejects positive tab order and automatic focus', () => {
  for (const source of [
    '<button tabIndex={2}>Open</button>',
    '<div tabIndex="3">Priority</div>',
    '<input autoFocus />',
    '<select autoFocus={false}><option>One</option></select>',
  ]) {
    assert.ok(findFocusAccessibilityEscapeHatch(source), source)
  }
})

test('focus accessibility guard rejects hiding intrinsic interactive controls', () => {
  for (const source of [
    '<button aria-hidden="true">Hidden</button>',
    '<input aria-hidden={true} />',
    '<select aria-hidden="true"><option>One</option></select>',
    '<textarea aria-hidden={true} />',
    '<a href="/help" aria-hidden="true">Help</a>',
  ]) {
    assert.ok(findFocusAccessibilityEscapeHatch(source), source)
  }
})

test('focus accessibility guard preserves intentional non-positive focus and presentation hiding', () => {
  for (const source of [
    '<div tabIndex={0}>Focusable</div>',
    '<div tabIndex={-1}>Programmatic focus target</div>',
    '<span aria-hidden="true">Decorative</span>',
    '<strong aria-hidden={true}>Presentation copy</strong>',
    '<a aria-hidden="true">Not a link</a>',
    '<button aria-hidden={false}>Visible</button>',
    'const note = "tabIndex={2} autoFocus aria-hidden=true"',
  ]) {
    assert.equal(findFocusAccessibilityEscapeHatch(source), null, source)
  }
})
