import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const labelledControlTags = new Set(['input', 'select', 'textarea'])
const defaultNamedInputTypes = new Set(['hidden', 'reset', 'submit'])

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

function attributeIdentity(attribute, sourceFile) {
  if (!attribute?.initializer) return null

  if (ts.isStringLiteral(attribute.initializer)) {
    return 'literal:' + attribute.initializer.text
  }

  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
    return null
  }

  return 'expression:' + unwrapExpression(attribute.initializer.expression).getText(sourceFile)
}

function intrinsicTagName(node) {
  return ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)
    ? node.tagName.text
    : null
}

function hasUsableNameAttribute(node, attributeName) {
  const attribute = attributeByName(node.attributes, attributeName)
  if (!attribute?.initializer) return false

  const staticValue = staticStringFromAttribute(attribute)
  return staticValue === null || staticValue.trim().length > 0
}

// An entirely empty label, or one containing only controls, does not
// supply an accessible name. Dynamic/unknown label content remains possible.
function hasPotentialLabelContent(labelElement) {
  return labelElement.children.some((child) => {
    if (ts.isJsxText(child)) return child.getText().trim().length > 0
    if (ts.isJsxSelfClosingElement(child) &&
      labelledControlTags.has(intrinsicTagName(child))) return false
    if (ts.isJsxElement(child) &&
      labelledControlTags.has(intrinsicTagName(child.openingElement))) return false
    return true
  })
}

function isWrappedByLabel(node) {
  let current = node.parent

  while (current) {
    if (
      ts.isJsxElement(current) &&
      intrinsicTagName(current.openingElement) === 'label' &&
      hasPotentialLabelContent(current)
    ) {
      return true
    }

    current = current.parent
  }

  return false
}

function isSelfNamingInput(node) {
  if (intrinsicTagName(node) !== 'input') return false

  const type = staticStringFromAttribute(attributeByName(node.attributes, 'type'))
  if (type === null) return false
  const normalizedType = type.trim().toLowerCase()
  if (defaultNamedInputTypes.has(normalizedType)) return true
  // input[type=button] has no fallback label; input[type=image] needs alt.
  if (normalizedType === 'button') return hasUsableNameAttribute(node, 'value')
  if (normalizedType === 'image') return hasUsableNameAttribute(node, 'alt')
  return false
}

function findUnlabelledFormControl(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  const labelTargets = new Set()
  let finding = null

  function collectLabelTargets(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      intrinsicTagName(node) === 'label'
    ) {
      const target = attributeIdentity(
        attributeByName(node.attributes, 'htmlFor'),
        sourceFile,
      )
      if (target !== null &&
        ts.isJsxOpeningElement(node) &&
        ts.isJsxElement(node.parent) &&
        hasPotentialLabelContent(node.parent)) labelTargets.add(target)
    }

    ts.forEachChild(node, collectLabelTargets)
  }

  collectLabelTargets(sourceFile)

  function inspectControl(node) {
    if (finding) return

    const tagName = intrinsicTagName(node)
    if (tagName === null || !labelledControlTags.has(tagName)) return
    if (isSelfNamingInput(node)) return
    if (isWrappedByLabel(node)) return
    if (hasUsableNameAttribute(node, 'aria-label')) return
    if (hasUsableNameAttribute(node, 'aria-labelledby')) return

    const id = attributeIdentity(attributeByName(node.attributes, 'id'), sourceFile)
    if (id !== null && labelTargets.has(id)) return

    finding = {
      kind: 'form control without a programmatic label',
      text: node.getText(sourceFile),
    }
  }

  function visit(node) {
    if (finding) return

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      inspectControl(node)
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

test('production intrinsic form controls keep programmatic labels', async () => {
  const files = await listProductionTsx(srcDir)
  assert.ok(files.length > 0, 'expected at least one production TSX file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findUnlabelledFormControl(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains ' +
        (finding?.kind ?? 'an unknown form-label issue') +
        ' via ' + (finding?.text ?? 'unknown source'),
    )
  }
})

test('form-label guard rejects unlabelled controls and mismatched explicit labels', () => {
  for (const source of [
    '<input />',
    '<select><option>One</option></select>',
    '<textarea />',
    '<input aria-label="" />',
    '<label><input /></label>',
    '<label>   <input /></label>',
    '<><label htmlFor="email" /><input id="email" /></>',
    '<><label htmlFor="email">   </label><input id="email" /></>',
    '<input aria-label="   " />',
    '<input id="email" /><label htmlFor="other">Email</label>',
    '<input type={inputType} />',
    '<input type="button" />',
    '<input type="button" value="" />',
    '<input type="image" />',
    '<input type="image" alt="  " />',
  ]) {
    assert.ok(findUnlabelledFormControl(source), source)
  }
})

test('form-label guard preserves wrapping, explicit, ARIA, and self-naming controls', () => {
  for (const source of [
    '<label>Name<input /></label>',
    '<label>{dynamicLabel}<input /></label>',
    '<label><span>Label</span><input /></label>',
    '<><label htmlFor="email">Email</label><input id="email" /></>',
    '<><label htmlFor={fieldId}>Field</label><select id={fieldId}><option>One</option></select></>',
    '<input aria-label="Search" />',
    '<textarea aria-labelledby={headingId} />',
    '<input type="hidden" />',
    '<input type="button" value="Open" />',
    '<input type="submit" value="Save" />',
    '<input type="reset" value="Reset" />',
    '<input type="image" alt="Save" />',
    '<input type="button" aria-label="Open" />',
    '<input type="image" aria-label="Save" />',
    '<Field onChange={change} />',
    'const example = "<input />"',
    '// <select><option>One</option></select>',
  ]) {
    assert.equal(findUnlabelledFormControl(source), null, source)
  }
})
