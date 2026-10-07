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

function findExplicitAny(source, filename = 'candidate.ts') {
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

    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      finding = {
        line: line + 1,
        text: node.getText(sourceFile),
      }
      return
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

test('explicit-any guard catches TypeScript any type nodes', () => {
  for (const source of [
    'let value: any',
    'const value = input as any',
    'type Unsafe = any',
    'type UnsafeList = Array<any>',
    'function parse(value: any): any { return value }',
  ]) {
    assert.ok(findExplicitAny(source), source)
  }
})

test('explicit-any guard preserves strongly typed and inert text', () => {
  for (const source of [
    'let value: unknown',
    'type Safe<T> = { value: T }',
    'const value = input as string',
    "const label = 'any'",
    '// let value: any',
    'const many = 3',
  ]) {
    assert.equal(findExplicitAny(source), null, source)
  }
})

test('financial domain source contains no explicit any types', async () => {
  const files = await listDomainSources(domainDir)
  assert.ok(files.length > 0, 'expected at least one domain TypeScript file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findExplicitAny(source, file.relativePath)

    assert.equal(
      finding,
      null,
      path.join('src/domain', file.relativePath) +
        ' contains explicit any at line ' +
        (finding?.line ?? '?') + ': ' + (finding?.text ?? 'any'),
    )
  }
})
