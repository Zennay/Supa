import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const domainDir = new URL('../src/domain/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])

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

function moduleSpecifierText(node) {
  return ts.isStringLiteralLike(node) ? node.text : null
}

function isReactRuntimeSpecifier(specifier) {
  return (
    specifier === 'react' ||
    specifier.startsWith('react/') ||
    specifier === 'react-dom' ||
    specifier.startsWith('react-dom/')
  )
}

function findReactRuntimeDependency(source, filename = 'candidate.ts') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  let finding = null

  function record(kind, node, specifier) {
    finding = {
      kind,
      specifier,
      text: node.getText(sourceFile),
    }
  }

  function visit(node) {
    if (finding) return

    if (ts.isImportDeclaration(node)) {
      const specifier = moduleSpecifierText(node.moduleSpecifier)
      if (specifier && isReactRuntimeSpecifier(specifier)) {
        record('import', node, specifier)
        return
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = moduleSpecifierText(node.moduleSpecifier)
      if (specifier && isReactRuntimeSpecifier(specifier)) {
        record('re-export', node, specifier)
        return
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const specifier = moduleSpecifierText(node.arguments[0])
      if (specifier && isReactRuntimeSpecifier(specifier)) {
        record('dynamic import', node, specifier)
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

test('pure domain layer has no React runtime dependency', async () => {
  const files = await listDomainSources(domainDir)
  assert.ok(files.length > 0, 'expected at least one domain source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findReactRuntimeDependency(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' depends on React runtime via ' +
        (finding?.kind ?? 'unknown dependency') + ' ' +
        JSON.stringify(finding?.specifier ?? 'unknown specifier') + ': ' +
        (finding?.text ?? 'unknown syntax'),
    )
  }
})

test('domain React runtime guard catches imports, re-exports and literal dynamic imports', () => {
  for (const source of [
    "import React from 'react'",
    "import { useMemo } from 'react'",
    "import { jsx } from 'react/jsx-runtime'",
    "import { createRoot } from 'react-dom/client'",
    "export { memo } from 'react'",
    "export * from 'react-dom'",
    "const runtime = import('react')",
    "const root = import('react-dom/client')",
  ]) {
    assert.ok(findReactRuntimeDependency(source), source)
  }
})

test('domain React runtime guard preserves ordinary domain imports and inert text', () => {
  for (const source of [
    "import { buildOneStoreBasket } from './basket'",
    "import type { BasketLine } from './basket'",
    "export { compareFullBaskets } from './basketComparison'",
    "const example = \"import React from 'react'\"",
    "// import { useMemo } from 'react'",
    "const specifier = 'react'; import(specifier)",
  ]) {
    assert.equal(findReactRuntimeDependency(source), null, source)
  }
})
