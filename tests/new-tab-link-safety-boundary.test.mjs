import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import * as ts from 'typescript'

const srcRoot = new URL('../src/', import.meta.url)

function jsxAttributeName(attribute) {
  if (!ts.isJsxAttribute(attribute)) return null
  return attribute.name.getText().toLowerCase()
}

function getJsxAttribute(opening, name) {
  const targetName = name.toLowerCase()

  for (const attribute of opening.attributes.properties) {
    if (jsxAttributeName(attribute) === targetName) return attribute
  }

  return null
}

function staticJsxAttributeValue(attribute) {
  if (!attribute || !ts.isJsxAttribute(attribute)) return null
  if (!attribute.initializer) return ''

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text
  }

  if (!ts.isJsxExpression(attribute.initializer)) return null

  const expression = attribute.initializer.expression
  if (!expression) return ''

  if (ts.isStringLiteralLike(expression)) return expression.text
  return null
}

function relTokens(value) {
  return new Set(
    value
      .trim()
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean),
  )
}

function openingTag(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return node
  }
  return null
}

function findUnsafeStaticNewTabLink(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let finding = null

  function visit(node) {
    if (finding) return

    const opening = openingTag(node)
    if (opening && opening.tagName.getText(sourceFile).toLowerCase() === 'a') {
      const targetAttribute = getJsxAttribute(opening, 'target')
      const targetValue = staticJsxAttributeValue(targetAttribute)

      if (targetValue?.trim().toLowerCase() === '_blank') {
        const relAttribute = getJsxAttribute(opening, 'rel')
        const relValue = staticJsxAttributeValue(relAttribute)

        if (relValue !== null) {
          const tokens = relTokens(relValue)
          if (!tokens.has('noopener') || !tokens.has('noreferrer')) {
            finding = {
              text: opening.getText(sourceFile),
              relValue,
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

async function listTsxFiles(directory = srcRoot) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...(await listTsxFiles(url)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.tsx')) {
      files.push(url)
    }
  }

  return files.sort((left, right) => left.href.localeCompare(right.href))
}

test('static production new-tab links carry noopener and noreferrer', async () => {
  const files = await listTsxFiles()
  assert.ok(files.length > 0, 'expected production TSX source files')

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const finding = findUnsafeStaticNewTabLink(source, file.pathname)

    assert.equal(
      finding,
      null,
      file.pathname +
        ' contains a static target="_blank" anchor without both noopener and noreferrer: ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('new-tab guard rejects missing or incomplete static rel tokens', () => {
  for (const source of [
    '<a target="_blank" href="https://example.com">Open</a>',
    '<a href="https://example.com" target="_blank" rel="">Open</a>',
    '<a target="_blank" rel="noopener">Open</a>',
    '<a target="_blank" rel="noreferrer">Open</a>',
    '<a target={"_blank"} rel="external noopener">Open</a>',
    '<a target={\'_blank\'} rel={\'noreferrer\'}>Open</a>',
  ]) {
    assert.ok(findUnsafeStaticNewTabLink(source), source)
  }
})

test('new-tab guard accepts complete static rel tokens', () => {
  for (const source of [
    '<a target="_blank" rel="noopener noreferrer">Open</a>',
    '<a target="_blank" rel="external noreferrer noopener">Open</a>',
    '<a target="_BLANK" rel="NOOPENER NOREFERRER">Open</a>',
    '<a target={"_blank"} rel={"noopener   noreferrer"}>Open</a>',
  ]) {
    assert.equal(findUnsafeStaticNewTabLink(source), null, source)
  }
})

test('new-tab guard does not guess dynamic target or rel expressions', () => {
  for (const source of [
    '<a target={target} rel={rel}>Open</a>',
    '<a target="_blank" rel={rel}>Open</a>',
    '<a target={openInNewTab ? "_blank" : "_self"} rel="noopener noreferrer">Open</a>',
    '<Link target="_blank" rel="noopener">Router link</Link>',
    'const example = \'<a target="_blank">example</a>\'',
    '// <a target="_blank">example</a>',
  ]) {
    assert.equal(findUnsafeStaticNewTabLink(source), null, source)
  }
})
