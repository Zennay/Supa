import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)

// Evaluate only literal-only expressions; never execute code or resolve
// variables. Static IDs wrapped in parentheses or concatenated in source are
// still static and must not bypass duplicate-id accessibility validation.
function staticStringExpression(node, depth = 0) {
  if (depth > 20) return null
  let current = node

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) current = current.expression

  if (ts.isStringLiteralLike(current)) return current.text

  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringExpression(current.left, depth + 1)
    const right = staticStringExpression(current.right, depth + 1)
    return left === null || right === null ? null : left + right
  }

  if (ts.isTemplateExpression(current)) {
    let value = current.head.text
    for (const span of current.templateSpans) {
      const part = staticStringExpression(span.expression, depth + 1)
      if (part === null) return null
      value += part + span.literal.text
    }
    return value
  }

  return null
}

function staticAttributeValue(initializer) {
  if (!initializer) return null
  if (ts.isStringLiteralLike(initializer)) return initializer.text
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return null
  return staticStringExpression(initializer.expression)
}

function isIntrinsicIdAttribute(node) {
  if (
    !ts.isJsxAttribute(node) ||
    !ts.isIdentifier(node.name) ||
    node.name.text !== 'id'
  ) {
    return false
  }

  const element = node.parent?.parent
  if (
    !element ||
    (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element))
  ) {
    return false
  }

  return (
    ts.isIdentifier(element.tagName) &&
    /^[a-z]/.test(element.tagName.text)
  )
}

function collectStaticIntrinsicIds(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const ids = []

  function visit(node) {
    if (isIntrinsicIdAttribute(node)) {
      const id = staticAttributeValue(node.initializer)

      if (id !== null && id.trim() !== '') {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        )
        ids.push({
          id,
          line: line + 1,
          column: character + 1,
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return ids
}

async function listProductionTsx(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    )

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

function duplicateStaticIds(sources) {
  const firstById = new Map()
  const duplicates = []

  for (const { filename, source } of sources) {
    for (const occurrence of collectStaticIntrinsicIds(source, filename)) {
      const first = firstById.get(occurrence.id)

      if (first) {
        duplicates.push({
          id: occurrence.id,
          first,
          duplicate: { filename, ...occurrence },
        })
        continue
      }

      firstById.set(occurrence.id, { filename, ...occurrence })
    }
  }

  return duplicates
}

test('production TSX contains no duplicate static intrinsic ids', async () => {
  const files = await listProductionTsx(srcDir)
  assert.ok(files.length > 0, 'expected at least one production TSX file')

  const sources = await Promise.all(
    files.map(async (file) => ({
      filename: file.relativePath,
      source: await readFile(file.url, 'utf8'),
    })),
  )
  const duplicates = duplicateStaticIds(sources)

  assert.deepEqual(
    duplicates,
    [],
    duplicates.length > 0
      ? duplicates
          .map(
            ({ id, first, duplicate }) =>
              `duplicate id "${id}": ${first.filename}:${first.line}:${first.column} and ${duplicate.filename}:${duplicate.line}:${duplicate.column}`,
          )
          .join('\n')
      : 'production source contains duplicate static intrinsic ids',
  )
})

test('static id guard catches literal and static-expression duplicates', () => {
  const duplicates = duplicateStaticIds([
    {
      filename: 'first.tsx',
      source: '<label id="account-name">Naam</label>',
    },
    {
      filename: 'second.tsx',
      source: "<input id={'account-name'} />",
    },
  ])

  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].id, 'account-name')
})

test('static id guard ignores dynamic ids and custom component props', () => {
  const duplicates = duplicateStaticIds([
    {
      filename: 'dynamic.tsx',
      source: [
        'const a = <select id={\`recipe-\${day}\`} />',
        'const b = <Field id="shared-component-prop" />',
        'const c = <Field id={"shared-component-prop"} />',
      ].join('\n'),
    },
  ])

  assert.deepEqual(duplicates, [])
})

test('static id guard detects composed literal IDs but not dynamic interpolations', () => {
  const duplicates = duplicateStaticIds([
    {
      filename: 'first.tsx',
      source: '<label id="account-name" />',
    },
    {
      filename: 'second.tsx',
      source: [
        "const a = <input id={('account' + '-name')} />",
        "const b = <input id={`account-${'name'}`} />",
        "const c = <input id={dynamicPrefix + '-name'} />",
        "const d = <input id={`account-${dynamicName}`} />",
      ].join('\\n'),
    },
  ])

  assert.equal(duplicates.length, 2)
  assert.deepEqual(duplicates.map(({ id }) => id), ['account-name', 'account-name'])
})

test('static id guard handles no-substitution template ids', () => {
  const ids = collectStaticIntrinsicIds(
    'const view = <div id={\`static-id\`} />',
  )

  assert.deepEqual(ids.map(({ id }) => id), ['static-id'])
})
