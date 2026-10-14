import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const domainDir = new URL('../src/domain/', import.meta.url)
const sourceExtensions = new Set(['.ts', '.tsx'])

function scriptKindFor(filename) {
  return path.extname(filename) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function unwrapParentheses(node) {
  let current = node
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

function isTypeAssertion(node) {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
}

function findChainedAssertion(source, filename = 'candidate.ts') {
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

    if (isTypeAssertion(node)) {
      const operand = unwrapParentheses(node.expression)
      if (isTypeAssertion(operand)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        finding = {
          line: line + 1,
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

async function listDomainSources(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listDomainSources(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('chained-assertion guard catches nested TypeScript assertions', () => {
  for (const source of [
    'const basket = input as unknown as Basket',
    'const basket = (input as unknown) as Basket',
    'const basket = <Basket>(<unknown>input)',
    'const basket = (<unknown>input) as Basket',
  ]) {
    assert.ok(findChainedAssertion(source), source)
  }
})

test('chained-assertion guard preserves single assertions and safer narrowing', () => {
  for (const source of [
    'const basket = input as Basket',
    'const basket = input satisfies Basket',
    'const value: unknown = input',
    "if (typeof input === 'string') input.toUpperCase()",
    "const example = 'input as unknown as Basket'",
    '// const basket = input as unknown as Basket',
  ]) {
    assert.equal(findChainedAssertion(source), null, source)
  }
})

test('financial domain source contains no chained type assertions', async () => {
  const files = await listDomainSources(domainDir)
  assert.ok(files.length > 0, 'expected at least one domain TypeScript file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findChainedAssertion(source, file.relativePath)

    assert.equal(
      finding,
      null,
      path.join('src/domain', file.relativePath) +
        ' contains a chained type assertion at line ' +
        (finding?.line ?? '?') + ': ' +
        (finding?.text ?? 'unknown assertion'),
    )
  }
})
