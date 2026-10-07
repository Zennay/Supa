import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const executableTags = new Set(['embed', 'iframe', 'object', 'script'])

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

function staticString(node) {
  if (!node) return null
  const current = unwrapExpression(node)
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text
  }
  return null
}

function isDocumentObject(node, documentAliases = new Set()) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) {
    return current.text === 'document' || documentAliases.has(current.text)
  }

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

function isReactObject(node, reactAliases = new Set()) {
  const current = unwrapExpression(node)
  return (
    ts.isIdentifier(current) &&
    (current.text === 'React' || reactAliases.has(current.text))
  )
}

function collectEmbeddedContentAliases(sourceFile) {
  const documentAliases = new Set()
  const reactAliases = new Set()
  const documentFactoryAliases = new Map()
  const reactCreateElementAliases = new Set()
  let changed = true

  function bindObjectPattern(pattern, initializer) {
    const documentObject = isDocumentObject(initializer, documentAliases)
    const reactObject = isReactObject(initializer, reactAliases)

    for (const element of pattern.elements) {
      if (!ts.isIdentifier(element.name)) continue
      const sourceName = staticName(element.propertyName) ?? element.name.text
      const alias = element.name.text

      if (
        documentObject &&
        (sourceName === 'createElement' || sourceName === 'createElementNS') &&
        documentFactoryAliases.get(alias) !== sourceName
      ) {
        documentFactoryAliases.set(alias, sourceName)
        changed = true
      }

      if (
        reactObject &&
        sourceName === 'createElement' &&
        !reactCreateElementAliases.has(alias)
      ) {
        reactCreateElementAliases.add(alias)
        changed = true
      }
    }
  }

  while (changed) {
    changed = false

    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const initializer = unwrapExpression(node.initializer)

        if (ts.isIdentifier(node.name)) {
          const alias = node.name.text

          if (!documentAliases.has(alias) && isDocumentObject(initializer, documentAliases)) {
            documentAliases.add(alias)
            changed = true
          }

          if (!reactAliases.has(alias) && isReactObject(initializer, reactAliases)) {
            reactAliases.add(alias)
            changed = true
          }

          if (ts.isIdentifier(initializer)) {
            const documentFactory = documentFactoryAliases.get(initializer.text)
            if (documentFactory && documentFactoryAliases.get(alias) !== documentFactory) {
              documentFactoryAliases.set(alias, documentFactory)
              changed = true
            }
            if (
              reactCreateElementAliases.has(initializer.text) &&
              !reactCreateElementAliases.has(alias)
            ) {
              reactCreateElementAliases.add(alias)
              changed = true
            }
          }

          if (
            ts.isPropertyAccessExpression(initializer) ||
            ts.isElementAccessExpression(initializer)
          ) {
            const method = memberName(initializer)

            if (
              isDocumentObject(initializer.expression, documentAliases) &&
              (method === 'createElement' || method === 'createElementNS') &&
              documentFactoryAliases.get(alias) !== method
            ) {
              documentFactoryAliases.set(alias, method)
              changed = true
            }

            if (
              isReactObject(initializer.expression, reactAliases) &&
              method === 'createElement' &&
              !reactCreateElementAliases.has(alias)
            ) {
              reactCreateElementAliases.add(alias)
              changed = true
            }
          }
        } else if (ts.isObjectBindingPattern(node.name)) {
          bindObjectPattern(node.name, initializer)
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return {
    documentAliases,
    reactAliases,
    documentFactoryAliases,
    reactCreateElementAliases,
  }
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

function executableTagName(node) {
  const value = staticString(node)
  if (value === null) return null
  return value.trim().toLowerCase()
}

function findExecutableEmbeddedContent(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )
  const {
    documentAliases,
    reactAliases,
    documentFactoryAliases,
    reactCreateElementAliases,
  } = collectEmbeddedContentAliases(sourceFile)

  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)
      let documentFactory = null
      let reactCreateElement = false

      if (ts.isIdentifier(callee)) {
        documentFactory = documentFactoryAliases.get(callee.text) ?? null
        reactCreateElement = reactCreateElementAliases.has(callee.text)
      } else if (
        ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)
      ) {
        const method = memberName(callee)

        if (
          isDocumentObject(callee.expression, documentAliases) &&
          (method === 'createElement' || method === 'createElementNS')
        ) {
          documentFactory = method
        }

        if (
          isReactObject(callee.expression, reactAliases) &&
          method === 'createElement'
        ) {
          reactCreateElement = true
        }
      }

      if (documentFactory === 'createElement') {
        const tag = executableTagName(node.arguments[0])
        if (tag === null) {
          finding = {
            kind: 'dynamic document.createElement tag',
            text: node.getText(sourceFile),
          }
          return
        }
        if (executableTags.has(tag)) {
          finding = {
            kind: 'executable document element',
            text: node.getText(sourceFile),
          }
          return
        }
      }

      if (documentFactory === 'createElementNS') {
        const tag = executableTagName(node.arguments[1])
        if (tag === null) {
          finding = {
            kind: 'dynamic document.createElementNS tag',
            text: node.getText(sourceFile),
          }
          return
        }
        if (executableTags.has(tag)) {
          finding = {
            kind: 'executable namespaced document element',
            text: node.getText(sourceFile),
          }
          return
        }
      }

      if (reactCreateElement) {
        const tag = executableTagName(node.arguments[0])
        if (tag !== null && executableTags.has(tag)) {
          finding = {
            kind: 'executable React element',
            text: node.getText(sourceFile),
          }
          return
        }
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile)
      if (executableTags.has(tag)) {
        finding = {
          kind: 'executable JSX element',
          text: '<' + node.tagName.getText(sourceFile) + '>',
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

test('production source has no unreviewed executable embedded content', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findExecutableEmbeddedContent(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden executable embedded content: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('embedded-content boundary catches executable DOM and JSX creation', () => {
  for (const source of [
    "document.createElement('script')",
    "window.document['createElement']('iframe')",
    "document.createElementNS('http://www.w3.org/2000/svg', 'script')",
    "document.createElement(tagName)",
    "document.createElementNS(namespace, tagName)",
    "React.createElement('object', { data: url })",
    "const view = <iframe src={url} />",
    "const view = <embed src={url} />",
    "const view = <object data={url}></object>",
    "const view = <script src={url}></script>",
  ]) {
    assert.ok(findExecutableEmbeddedContent(source), source)
  }
})

test('embedded-content boundary follows document and React aliases', () => {
  for (const source of [
    "const doc = document; doc.createElement('iframe')",
    "const doc = window.document; const next = doc; next.createElement('script')",
    "const { createElement } = document; createElement('object')",
    "const { createElementNS: makeNs } = window.document; makeNs('http://www.w3.org/2000/svg', 'script')",
    "const make = document.createElement; const nextMake = make; nextMake('embed')",
    "const R = React; R.createElement('iframe', { src: url })",
    "const { createElement: makeReact } = React; makeReact('script', { src: url })",
  ]) {
    assert.ok(findExecutableEmbeddedContent(source), source)
  }
})

test('embedded-content boundary preserves reviewed non-executable creation paths', () => {
  for (const source of [
    "document.createElement('a')",
    "window.document.createElement('div')",
    "document.createElementNS('http://www.w3.org/2000/svg', 'svg')",
    "React.createElement('section', null)",
    "React.createElement(Component, props)",
    "const view = <div><img src={imageUrl} alt=\"preview\" /></div>",
    "const Script = () => null; const view = <Script />",
    "// document.createElement('script')",
    "const example = \"<iframe src='/example'></iframe>\"",
    "const doc = editor.document; doc.createElement('iframe')",
    "const { createElement } = factory; createElement('script')",
    "const R = ui.React; R.createElement('iframe', { src: url })",
    "const { createElement: make } = ui; make('script')",
  ]) {
    assert.equal(findExecutableEmbeddedContent(source), null, source)
  }
})
