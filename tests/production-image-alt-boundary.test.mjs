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

function staticStringFromAttribute(attribute) {
  if (!attribute?.initializer) return null

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text
  }

  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return null
  }

  const expression = unwrapExpression(attribute.initializer.expression)
  return ts.isStringLiteralLike(expression) ? expression.text : null
}

function intrinsicTagName(node) {
  return ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)
    ? node.tagName.text
    : null
}

function findImageWithoutAlt(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  let finding = null

  function inspectOpeningElement(node) {
    if (finding) return

    const tagName = intrinsicTagName(node)
    if (tagName === null) return

    const isImage =
      tagName === 'img' ||
      (
        tagName === 'input' &&
        staticStringFromAttribute(attributeByName(node.attributes, 'type'))
          ?.trim()
          .toLowerCase() === 'image'
      )

    if (!isImage) return

    if (!attributeByName(node.attributes, 'alt')) {
      finding = {
        kind: tagName === 'img' ? 'img without alt' : 'image input without alt',
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

test('production intrinsic images declare alternative-text semantics', async () => {
  const files = await listProductionTsx(srcDir)
  assert.ok(files.length > 0, 'expected at least one production TSX file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findImageWithoutAlt(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains ' +
        (finding?.kind ?? 'an unknown image accessibility issue') +
        ' via ' + (finding?.text ?? 'unknown source'),
    )
  }
})

test('image-alt guard rejects intrinsic images without alt', () => {
  for (const source of [
    '<img src="/meal.png" />',
    '<img src={imageUrl}></img>',
    '<input type="image" src="/submit.png" />',
    '<input type={"IMAGE"} src={submitImage} />',
    "<input type={('image')} src={submitImage} />",
  ]) {
    assert.ok(findImageWithoutAlt(source), source)
  }
})

test('image-alt guard preserves declared decorative and meaningful alternatives', () => {
  for (const source of [
    '<img src="/decorative.png" alt="" />',
    '<img src={imageUrl} alt={description} />',
    '<input type="image" src="/submit.png" alt="Opslaan" />',
    '<input type={inputType} src={submitImage} />',
    '<input type="text" />',
    '<Image src={imageUrl} />',
    '<MealImage />',
    'const example = "<img src=\"/example.png\" />"',
    '// <img src="/example.png" />',
  ]) {
    assert.equal(findImageWithoutAlt(source), null, source)
  }
})
