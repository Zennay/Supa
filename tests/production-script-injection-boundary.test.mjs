import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import * as ts from 'typescript'

const srcRoot = new URL('../src/', import.meta.url)

function staticMemberName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text
  }
  return null
}

function staticPath(expression) {
  if (ts.isIdentifier(expression)) return [expression.text]

  if (ts.isPropertyAccessExpression(expression)) {
    const base = staticPath(expression.expression)
    return base ? [...base, expression.name.text] : null
  }

  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    const base = staticPath(expression.expression)
    return base ? [...base, expression.argumentExpression.text] : null
  }

  return null
}

function isAssignmentOperator(kind) {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  )
}

function propertyNameText(name, sourceFile) {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text
  }
  return name.getText(sourceFile)
}

function classifyFinding(node, sourceFile) {
  if (
    ts.isJsxAttribute(node) &&
    propertyNameText(node.name, sourceFile) === 'dangerouslySetInnerHTML'
  ) {
    return {
      kind: 'React dangerouslySetInnerHTML',
      text: node.getText(sourceFile),
    }
  }

  if (
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    propertyNameText(node.name, sourceFile) === 'dangerouslySetInnerHTML'
  ) {
    return {
      kind: 'dangerouslySetInnerHTML property',
      text: node.getText(sourceFile),
    }
  }

  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    staticMemberName(node.left) === 'innerHTML'
  ) {
    return {
      kind: 'innerHTML assignment',
      text: node.getText(sourceFile),
    }
  }

  if (ts.isCallExpression(node)) {
    const path = staticPath(node.expression)
    if (path) {
      const dotted = path.join('.')

      if (
        dotted === 'document.write' ||
        dotted === 'document.writeln' ||
        dotted === 'window.document.write' ||
        dotted === 'window.document.writeln' ||
        dotted === 'globalThis.document.write' ||
        dotted === 'globalThis.document.writeln' ||
        dotted === 'self.document.write' ||
        dotted === 'self.document.writeln'
      ) {
        return {
          kind: 'document.write',
          text: node.expression.getText(sourceFile),
        }
      }

      if (
        dotted === 'eval' ||
        dotted === 'window.eval' ||
        dotted === 'globalThis.eval' ||
        dotted === 'self.eval'
      ) {
        return {
          kind: 'eval',
          text: node.expression.getText(sourceFile),
        }
      }

      if (
        dotted === 'Function' ||
        dotted === 'window.Function' ||
        dotted === 'globalThis.Function' ||
        dotted === 'self.Function'
      ) {
        return {
          kind: 'Function constructor call',
          text: node.expression.getText(sourceFile),
        }
      }
    }
  }

  if (ts.isNewExpression(node)) {
    const path = staticPath(node.expression)
    if (path) {
      const dotted = path.join('.')
      if (
        dotted === 'Function' ||
        dotted === 'window.Function' ||
        dotted === 'globalThis.Function' ||
        dotted === 'self.Function'
      ) {
        return {
          kind: 'Function constructor',
          text: node.expression.getText(sourceFile),
        }
      }
    }
  }

  return null
}

function findUnsafeInjectionPrimitive(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  let finding = null

  function visit(node) {
    if (finding) return
    finding = classifyFinding(node, sourceFile)
    if (!finding) ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

async function listProductionSourceFiles(directory = srcRoot) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...(await listProductionSourceFiles(url)))
      continue
    }

    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(url)
    }
  }

  return files.sort((left, right) => left.href.localeCompare(right.href))
}

test('production source avoids direct executable HTML/script injection primitives', async () => {
  const files = await listProductionSourceFiles()
  assert.ok(files.length > 0, 'expected production TypeScript source files')

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const finding = findUnsafeInjectionPrimitive(source, file.pathname)

    assert.equal(
      finding,
      null,
      file.pathname +
        ' contains forbidden ' +
        (finding?.kind ?? 'injection primitive') +
        ': ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('injection guard rejects executable HTML sinks', () => {
  for (const source of [
    '<div dangerouslySetInnerHTML={{ __html: html }} />',
    "const props = { dangerouslySetInnerHTML: { __html: html } }",
    'node.innerHTML = html',
    "node['innerHTML'] += html",
    'document.write(html)',
    'document.writeln(html)',
    'window.document.write(html)',
    "globalThis.document['writeln'](html)",
  ]) {
    assert.ok(findUnsafeInjectionPrimitive(source), source)
  }
})

test('injection guard rejects direct dynamic-code execution', () => {
  for (const source of [
    'eval(code)',
    'window.eval(code)',
    "globalThis['eval'](code)",
    'Function(code)',
    'new Function(code)',
    "self['Function'](code)",
  ]) {
    assert.ok(findUnsafeInjectionPrimitive(source), source)
  }
})

test('injection guard preserves inert text and non-executable DOM usage', () => {
  for (const source of [
    "// dangerouslySetInnerHTML={{ __html: html }}",
    "const example = 'node.innerHTML = html'",
    "const label = 'document.write(html)'",
    "const word = 'eval(code)'",
    'const html = node.innerHTML',
    'const fragment = document.createDocumentFragment()',
    'const text = document.createTextNode(value)',
    'const parser = new DOMParser()',
    'helper.eval(code)',
    'new HelperFunction(code)',
  ]) {
    assert.equal(findUnsafeInjectionPrimitive(source), null, source)
  }
})
