import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const jsxExtensions = new Set(['.jsx', '.tsx'])
const urlAttributes = new Set(['href', 'src', 'action', 'formaction', 'xlinkhref'])

function unwrapExpression(node) {
  let current = node
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression
  }
  return current
}

function staticAttributeValue(initializer) {
  if (!initializer) return null

  if (ts.isStringLiteral(initializer)) return initializer.text

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expression = unwrapExpression(initializer.expression)
    if (
      ts.isStringLiteralLike(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text
    }
  }

  return null
}

function attributeName(name) {
  if (ts.isIdentifier(name)) return name.text.toLowerCase()
  if (ts.isJsxNamespacedName(name)) {
    return (name.namespace.text + ':' + name.name.text).toLowerCase()
  }
  return null
}

function normalizeSchemeInput(value) {
  return value
    .replace(/[\\t\\n\\r]/g, '')
    .replace(/^[\\u0000-\\u0020]+/, '')
    .toLowerCase()
}

function isExecutableUrl(value) {
  return normalizeSchemeInput(value).startsWith('javascript:')
}

function scriptKindFor(filename) {
  return path.extname(filename) === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
}

function findExecutableStaticJsxUrl(source, filename = 'candidate.tsx') {
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

    if (ts.isJsxAttribute(node)) {
      const name = attributeName(node.name)
      const value = staticAttributeValue(node.initializer)

      if (name && urlAttributes.has(name) && value !== null && isExecutableUrl(value)) {
        finding = {
          attribute: node.name.getText(sourceFile),
          value,
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

async function listProductionJsx(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listProductionJsx(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && jsxExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('production JSX contains no static javascript URL schemes', async () => {
  const files = await listProductionJsx(srcDir)
  assert.ok(files.length > 0, 'expected at least one production JSX/TSX source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findExecutableStaticJsxUrl(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains an executable static JSX URL: ' +
        (finding?.attribute ?? 'unknown attribute') + '=' +
        JSON.stringify(finding?.value ?? 'unknown value'),
    )
  }
})

test('JSX URL guard rejects static executable schemes', () => {
  for (const source of [
    '<a href="javascript:alert(1)">x</a>',
    "<iframe src={'JaVaScRiPt:alert(1)'} />",
    '<form action={`javascript:alert(1)`} />',
    '<button formAction={"  javascript:submit()"} />',
    '<use xlinkHref="javascript:alert(1)" />',
    '<a href={"java\\nscript:alert(1)"}>x</a>',
    '<a href={"\\u0000javascript:alert(1)"}>x</a>',
  ]) {
    assert.ok(findExecutableStaticJsxUrl(source), source)
  }
})

test('JSX URL guard preserves safe, dynamic and inert values', () => {
  for (const source of [
    '<a href="/planner">Planner</a>',
    '<a href={"https://example.test"}>Extern</a>',
    '<img src={assetUrl} alt="" />',
    '<form action={submitUrl}></form>',
    '<div data-href="javascript:example">tekst</div>',
    "const example = '<a href=\"javascript:alert(1)\">x</a>'",
  ]) {
    assert.equal(findExecutableStaticJsxUrl(source), null, source)
  }
})
