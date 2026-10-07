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

function isReactObject(node) {
  const current = unwrapExpression(node)
  return ts.isIdentifier(current) && current.text === 'React'
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

  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)

      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const method = memberName(callee)

        if (isDocumentObject(callee.expression) && method === 'createElement') {
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

        if (isDocumentObject(callee.expression) && method === 'createElementNS') {
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

        if (isReactObject(callee.expression) && method === 'createElement') {
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
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile).toLowerCase()
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
  ]) {
    assert.equal(findExecutableEmbeddedContent(source), null, source)
  }
})
