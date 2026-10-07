import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const resourceAttributes = new Map([
  ['audio', new Set(['src'])],
  ['image', new Set(['href', 'xlinkHref'])],
  ['img', new Set(['src', 'srcSet'])],
  ['link', new Set(['href'])],
  ['script', new Set(['src'])],
  ['source', new Set(['src', 'srcSet'])],
  ['track', new Set(['src'])],
  ['use', new Set(['href', 'xlinkHref'])],
  ['video', new Set(['poster', 'src'])],
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

function staticString(node) {
  if (!node) return null
  const current = unwrapExpression(node)
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text
  }
  return null
}

function isReactCreateElement(node) {
  const current = unwrapExpression(node)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    base.text === 'React' &&
    memberName(current) === 'createElement'
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

function jsxAttributeNames(node) {
  const names = new Set()
  let hasSpread = false

  for (const property of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      hasSpread = true
      continue
    }

    if (ts.isJsxAttribute(property)) {
      names.add(property.name.getText())
    }
  }

  return { names, hasSpread }
}

function resourceBearingJsxElement(node, sourceFile) {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
    return null
  }

  const tag = node.tagName.getText(sourceFile)
  const watchedAttributes = resourceAttributes.get(tag)
  if (!watchedAttributes) return null

  const { names, hasSpread } = jsxAttributeNames(node)
  if (hasSpread) {
    return {
      kind: 'resource element with spread attributes',
      text: '<' + tag + ' {...}>',
    }
  }

  for (const name of watchedAttributes) {
    if (names.has(name)) {
      return {
        kind: tag + '.' + name + ' browser subresource',
        text: '<' + tag + ' ' + name + '=...>',
      }
    }
  }

  return null
}

function findBrowserSubresource(source, filename = 'candidate.tsx') {
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

    const jsxFinding = resourceBearingJsxElement(node, sourceFile)
    if (jsxFinding) {
      finding = jsxFinding
      return
    }

    if (ts.isCallExpression(node) && isReactCreateElement(node.expression)) {
      const tag = staticString(node.arguments[0])
      if (tag !== null && resourceAttributes.has(tag)) {
        finding = {
          kind: 'React.createElement browser subresource element',
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

test('production source has no unreviewed browser subresource elements', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findBrowserSubresource(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains an unreviewed browser subresource: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('subresource boundary catches intrinsic browser resource loads', () => {
  for (const source of [
    'const view = <img src={url} alt="" />',
    'const view = <img srcSet={srcSet} alt="" />',
    'const view = <link rel="stylesheet" href={url} />',
    'const view = <script src={url}></script>',
    'const view = <script {...props}></script>',
    'const view = <video poster={posterUrl} />',
    'const view = <audio src={url} />',
    'const view = <source srcSet={srcSet} />',
    'const view = <track src={url} />',
    'const view = <image href={url} />',
    'const view = <use xlinkHref={url} />',
    'const view = <img {...props} />',
    "React.createElement('img', { src: url })",
    "React.createElement('link', props)",
    "React.createElement('script', { src: url })",
  ]) {
    assert.ok(findBrowserSubresource(source), source)
  }
})

test('subresource boundary preserves non-loading markup and React components', () => {
  for (const source of [
    'const view = <img alt="placeholder" />',
    'const view = <video controls />',
    'const view = <link rel="canonical" />',
    'const view = <script>const message = "inline example"</script>',
    'const view = <Script src={url} />',
    'const view = <Image src={url} />',
    'const view = <Source src={url} />',
    'const view = <div data-src={url} />',
    'const example = "<img src=/example.png>"',
    '// const view = <img src={url} />',
    'elementFactory.img({ src: url })',
  ]) {
    assert.equal(findBrowserSubresource(source), null, source)
  }
})
