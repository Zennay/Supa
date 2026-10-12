import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)

// Evaluate only literal-only expressions; never execute code or resolve
// variables. Static IDs wrapped in parentheses or concatenated in source are
// still static and must not bypass duplicate-id accessibility validation.
function unwrapStaticExpression(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) current = current.expression
  return current
}

// Literal-only primitive evaluator: preserve JS operand types until final
// coercion. Treating every numeric subexpression as a string makes
// "id-" + (1 + 2) incorrectly look like "id-12" rather than "id-3".
function staticPrimitiveExpression(node, depth = 0) {
  if (depth > 20) return null
  const current = unwrapStaticExpression(node)

  if (ts.isStringLiteralLike(current)) return current.text
  // JavaScript coerces literal Booleans in string addition and interpolation.
  // Keep their primitive type until final ID coercion; never infer variables.
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isNumericLiteral(current)) {
    const value = Number(current.text.replaceAll('_', ''))
    return Number.isFinite(value) ? value : null
  }
  if (ts.isBigIntLiteral(current)) {
    try {
      // Do not round large literal IDs through IEEE-754 Number.
      return BigInt(current.text.replaceAll('_', '').replace(/n$/, ''))
    } catch {
      return null
    }
  }

  if (ts.isPrefixUnaryExpression(current) &&
      (current.operator === ts.SyntaxKind.MinusToken ||
       current.operator === ts.SyntaxKind.PlusToken)) {
    const value = staticPrimitiveExpression(current.operand, depth + 1)
    if (typeof value === 'number') {
      const signed = current.operator === ts.SyntaxKind.MinusToken ? -value : value
      return Number.isFinite(signed) ? signed : null
    }
    // Unary + on a BigInt throws in JavaScript; do not invent an ID.
    if (typeof value === 'bigint' && current.operator === ts.SyntaxKind.MinusToken) {
      return -value
    }
    return null
  }

  if (ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticPrimitiveExpression(current.left, depth + 1)
    const right = staticPrimitiveExpression(current.right, depth + 1)
    if (left === null || right === null) return null
    // Once either operand is a string, JS performs concatenation.
    if (typeof left === 'string' || typeof right === 'string') {
      return String(left) + String(right)
    }
    if (typeof left === 'number' && typeof right === 'number') {
      const sum = left + right
      return Number.isFinite(sum) ? sum : null
    }
    if (typeof left === 'bigint' && typeof right === 'bigint') {
      return left + right
    }
    // Number + BigInt throws; dynamic or invalid expressions stay unknown.
    return null
  }

  if (ts.isTemplateExpression(current)) {
    let value = current.head.text
    for (const span of current.templateSpans) {
      const part = staticPrimitiveExpression(span.expression, depth + 1)
      if (part === null) return null
      value += String(part) + span.literal.text
    }
    return value
  }

  return null
}

function staticStringExpression(node, depth = 0) {
  const value = staticPrimitiveExpression(node, depth)
  // React omits direct Boolean values for a non-Boolean HTML id attribute.
  // Only infer Boolean ID text when JS explicitly coerces it inside a
  // string concatenation or template interpolation.
  return value === null || typeof value === 'boolean' ? null : String(value)
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

    // A literal JSX attributes spread may also declare an intrinsic element ID.
    // Only parse direct object literals; variables and dynamic values remain unknown.
    if (ts.isJsxSpreadAttribute(node)) {
      const element = node.parent?.parent
      const intrinsic = element &&
        (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
        ts.isIdentifier(element.tagName) && /^[a-z]/.test(element.tagName.text)
      const object = unwrapStaticExpression(node.expression)
      if (intrinsic && ts.isObjectLiteralExpression(object)) {
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const key = property.name
          const keyName = ts.isIdentifier(key) || ts.isStringLiteralLike(key)
            ? key.text
            : ts.isComputedPropertyName(key)
              ? staticStringExpression(key.expression)
              : null
          if (keyName !== 'id') continue
          const id = staticStringExpression(property.initializer)
          if (id === null || id.trim() === '') continue
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            property.getStart(sourceFile),
          )
          ids.push({ id, line: line + 1, column: character + 1 })
        }
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
      ].join('\n'),
    },
  ])

  assert.equal(duplicates.length, 2)
  assert.deepEqual(duplicates.map(({ id }) => id), ['account-name', 'account-name'])
})

test('static id guard resolves typed constant ids without evaluating variable references', () => {
  const sources = [
    { filename: 'a.tsx', source: '<input id="typed-duplicate" />' },
    { filename: 'b.tsx', source: '<label id={(("typed" + "-duplicate") satisfies string)} />' },
    { filename: 'c.tsx', source: '<label id={(dynamicId satisfies string)} />' },
  ]
  const duplicates = duplicateStaticIds(sources)
  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].id, 'typed-duplicate')
})

test('static id guard detects duplicate intrinsic IDs in constant JSX spreads', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'original.tsx', source: '<label id="account-name" />' },
    {
      filename: 'spread.tsx',
      source: [
        '<input {...{ id: "account-name" }} />',
        '<div {...({ ["id"]: "account" + "-name" } satisfies Record<string, string>)} />',
      ].join('\n'),
    },
  ])
  assert.equal(duplicates.length, 2)
  assert.deepEqual(duplicates.map(({ id }) => id), ['account-name', 'account-name'])
})

test('static id guard does not infer dynamic or custom-component spread props', () => {
  const duplicates = duplicateStaticIds([
    {
      filename: 'dynamic.tsx',
      source: [
        '<div {...{ id: runtimeId }} />',
        '<div {...runtimeProps} />',
        '<Field {...{ id: "same" }} />',
        '<Field {...{ id: "same" }} />',
        '<div {...{ [computedName]: "same" }} />',
      ].join('\n'),
    },
  ])
  assert.deepEqual(duplicates, [])
})

test('static id guard handles no-substitution template ids', () => {
  const ids = collectStaticIntrinsicIds(
    'const view = <div id={\`static-id\`} />',
  )

  assert.deepEqual(ids.map(({ id }) => id), ['static-id'])
})

test('QA #1006: compile-time numeric JSX ID interpolation must not evade duplicates [expected RED]', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'known.tsx', source: '<label id="row-2" />' },
    {
      filename: 'numeric.tsx',
      source: [
        'const a = <input id={"row-" + 2} />',
        'const b = <div id={`row-${2}`} />',
        'const c = <span {...{ id: "row-" + 2 }} />',
        'const d = <output id={"row-" + runtimeIndex} />',
        'const e = <Field id={"row-" + 2} />',
      ].join('\n'),
    },
  ])
  assert.equal(duplicates.length, 3, 'all three literal-only intrinsic duplicates should be detected')
  assert.deepEqual(duplicates.map(({ id }) => id), ['row-2', 'row-2', 'row-2'])
})

test('QA #1006: numeric static IDs remain distinct and dynamic numeric IDs are not guessed', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'a.tsx', source: '<div id="week-3" />' },
    { filename: 'b.tsx', source: [
      'const a = <div id={"week-" + 4} />',
      'const b = <div id={`week-${runtimeWeek}`} />',
      'const c = <div {...{ id: "week-" + externalWeek }} />',
    ].join('\n') },
  ])
  assert.deepEqual(duplicates, [])
})

test('QA #1006: finite signed and radix numeric constants resolve exactly, dynamic IDs stay unknown', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'orig.tsx', source: [
      '<div id="slot--2" />',
      '<div id="slot-16" />',
      '<div id="slot-1000" />',
    ].join('\n') },
    { filename: 'derived.tsx', source: [
      'const a = <input id={"slot-" + (-2)} />',
      'const b = <output id={`slot-${-2}`} />',
      'const c = <span {...{id: "slot-" + 0x10}} />',
      'const d = <span id={"slot-" + 1_000} />',
      'const e = <span id={"slot-" + variableNumber} />',
      'const f = <CustomWidget id={"slot-" + (-2)} />',
    ].join('\n') },
  ])
  assert.deepEqual(duplicates.map(row => row.id),
    ['slot--2', 'slot--2', 'slot-16', 'slot-1000'])
})
