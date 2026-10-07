import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
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

function findUndocumentedEmptyCatch(source, filename = 'candidate.tsx') {
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

    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const inner = source.slice(node.block.getStart(sourceFile) + 1, node.block.getEnd() - 1)

      if (inner.trim() === '') {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        finding = {
          line: line + 1,
          column: character + 1,
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

test('production source contains no undocumented empty catch blocks', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findUndocumentedEmptyCatch(source, file.relativePath)

    assert.equal(
      finding,
      null,
      finding
        ? `${file.relativePath}:${finding.line}:${finding.column} silently swallows an error with an empty catch block`
        : `${file.relativePath} contains an undocumented empty catch block`,
    )
  }
})

test('empty-catch guard rejects completely empty catches', () => {
  for (const source of [
    'try { risky() } catch {}',
    'try { risky() } catch (error) {   }',
  ]) {
    assert.ok(findUndocumentedEmptyCatch(source), source)
  }
})

test('empty-catch guard preserves deliberate recovery and documented best-effort catches', () => {
  for (const source of [
    'try { risky() } catch { return fallback }',
    'try { risky() } catch { throw new Error("failed") }',
    'try { risky() } catch { /* best effort only */ }',
    'try { risky() } catch { // storage may be unavailable\n }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(source), null, source)
  }
})
