import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const htmlPropertySinks = new Set(['innerHTML', 'outerHTML', 'srcdoc'])
const documentWriteSinks = new Set(['write', 'writeln'])
const htmlCallSinks = new Set([
  'createContextualFragment',
  'insertAdjacentHTML',
  'parseHTMLUnsafe',
  'setHTMLUnsafe',
])

function staticName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  if (ts.isComputedPropertyName(node)) return staticName(node.expression)
  return null
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return staticName(node.argumentExpression)
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

function isDocumentObject(node) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) return current.text === 'document'

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    memberName(current) === 'document'
  )
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

function findRawHtmlSink(source, filename = 'candidate.tsx') {
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

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isDocumentObject(node.initializer)
    ) {
      finding = {
        kind: 'document alias',
        text: node.getText(sourceFile),
      }
      return
    }

    if (
      ts.isJsxAttribute(node) &&
      staticName(node.name) === 'dangerouslySetInnerHTML'
    ) {
      finding = {
        kind: 'dangerouslySetInnerHTML attribute',
        text: node.getText(sourceFile),
      }
      return
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node)

      if (htmlPropertySinks.has(name)) {
        finding = {
          kind: name + ' access',
          text: node.getText(sourceFile),
        }
        return
      }

      if (
        htmlCallSinks.has(name) &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      ) {
        finding = {
          kind: name + ' call',
          text: node.getText(sourceFile),
        }
        return
      }

      if (
        documentWriteSinks.has(name) &&
        isDocumentObject(node.expression) &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      ) {
        finding = {
          kind: 'document.' + name + ' call',
          text: node.getText(sourceFile),
        }
        return
      }
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

test('production source contains no raw HTML injection sinks', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findRawHtmlSink(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains a forbidden raw HTML sink: ' +
        (finding?.kind ?? 'unknown sink') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('raw HTML guard catches React and DOM injection sinks', () => {
  for (const source of [
    "const view = <div dangerouslySetInnerHTML={{ __html: html }} />",
    "node.innerHTML = html",
    "const previous = node['outerHTML']",
    "iframe.srcdoc = html",
    "const embedded = iframe['srcdoc']",
    "node.insertAdjacentHTML('beforeend', html)",
    "node['insertAdjacentHTML']('afterbegin', html)",
    "range.createContextualFragment(html)",
    "element.setHTMLUnsafe(html)",
    "Document.parseHTMLUnsafe(html)",
    "shadowRoot['setHTMLUnsafe'](html)",
    "document.write(html)",
    "document['writeln'](html)",
    "window.document.write(html)",
    "globalThis['document']['writeln'](html)",
    "const doc = document",
    "const doc = (window.document)",
    "const doc = (globalThis['document'] as Document)",
    "const { write } = self.document",
  ]) {
    assert.ok(findRawHtmlSink(source), source)
  }
})

test('raw HTML guard ignores comments, strings and non-sink identifiers', () => {
  for (const source of [
    "// document.write(html)",
    "const example = \"dangerouslySetInnerHTML node.outerHTML iframe.srcdoc\"",
    "const innerHTML = sanitizedText",
    "const srcdoc = sanitizedText",
    "const payload = { innerHTML: sanitizedText, srcdoc: sanitizedText }",
    "const insertAdjacentHTML = () => 'example'",
    "const createContextualFragment = () => 'example'",
    "const setHTMLUnsafe = () => 'example'",
    "const parseHTMLUnsafe = () => 'example'",
    "printer.write(html)",
    "writer.writeln(html)",
    "const doc = runtime.document",
    "const doc = { write() {}, writeln() {} }",
    "const write = () => 'example'",
  ]) {
    assert.equal(findRawHtmlSink(source), null, source)
  }
})
