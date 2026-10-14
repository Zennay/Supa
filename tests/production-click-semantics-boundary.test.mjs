import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const nativeInteractiveTags = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'summary',
])

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

function intrinsicTagName(node) {
  return ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)
    ? node.tagName.text
    : null
}

function isNativeInteractive(node) {
  const tagName = intrinsicTagName(node)
  if (tagName === null) return true

  if (nativeInteractiveTags.has(tagName)) return true
  if (tagName === 'a' && attributeByName(node.attributes, 'href')) return true

  return false
}

function findNonInteractiveClickHandler(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  let finding = null

  function inspectOpeningElement(node) {
    if (finding) return

    const onClick = attributeByName(node.attributes, 'onClick')
    if (!onClick) return

    const tagName = intrinsicTagName(node)
    if (tagName === null || isNativeInteractive(node)) return

    finding = {
      kind: 'onClick on non-interactive intrinsic element',
      text: node.getText(sourceFile),
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

test('production click handlers stay on native interactive elements', async () => {
  const files = await listProductionTsx(srcDir)
  assert.ok(files.length > 0, 'expected at least one production TSX file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findNonInteractiveClickHandler(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains ' +
        (finding?.kind ?? 'an unknown click-semantics issue') +
        ' via ' + (finding?.text ?? 'unknown source'),
    )
  }
})

test('click-semantics guard rejects mouse-only intrinsic click surfaces', () => {
  for (const source of [
    '<div onClick={open}>Open</div>',
    '<span onClick={() => choose()}>Choose</span>',
    '<section onClick={toggle}>Toggle</section>',
    '<li onClick={select}>Select</li>',
    '<a onClick={open}>Missing href</a>',
  ]) {
    assert.ok(findNonInteractiveClickHandler(source), source)
  }
})

test('click-semantics guard preserves native controls and custom components', () => {
  for (const source of [
    '<button onClick={save}>Save</button>',
    '<input onClick={activate} />',
    '<select onClick={activate}><option>One</option></select>',
    '<textarea onClick={activate} />',
    '<summary onClick={toggle}>Details</summary>',
    '<a href="/planner" onClick={navigate}>Planner</a>',
    '<a href={destination} onClick={navigate}>Destination</a>',
    '<Card onClick={open} />',
    '<InteractiveRow onClick={select} />',
    'const example = "<div onClick={open}>Example</div>"',
    '// <span onClick={open}>Example</span>',
  ]) {
    assert.equal(findNonInteractiveClickHandler(source), null, source)
  }
})
