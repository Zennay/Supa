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

function hasExplanatoryComment(source) {
  const comments = source.match(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g) ?? []

  return comments.some((comment) => {
    const text = comment.startsWith('//')
      ? comment.slice(2)
      : comment
          .slice(2, -2)
          .replace(/^\s*\*\s?/gm, '')

    const explanation = text.trim()
    // A placeholder or a lint suppression is not an error-handling rationale.
    if (/^@?(?:todo|fixme|tbd|xxx)(?:\b|\s*[:!-])/i.test(explanation)) return false
    // Suppression/enable directives alone are not explanations for discarding
    // an error, even when introduced with legacy tslint or TypeScript markers.
    if (/^(?:eslint-(?:disable|enable)(?:-next-line|-line)?|tslint(?:-disable|:disable)|@ts-(?:ignore|expect-error|nocheck|check))\b/i.test(explanation)) {
      return false
    }
    // A numeric code by itself is not a rationale for discarding a failure.
    // Require at least one word character that is a Unicode letter.
    return /[\p{L}]/u.test(explanation)
  })
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
      const inner = source.slice(
        node.block.getStart(sourceFile) + 1,
        node.block.getEnd() - 1,
      )

      if (!hasExplanatoryComment(inner)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        )
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
    const childUrl = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    )

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
        ? `${file.relativePath}:${finding.line}:${finding.column} silently swallows an error with an undocumented empty catch block`
        : `${file.relativePath} contains an undocumented empty catch block`,
    )
  }
})

test('empty-catch guard rejects catches without explanatory content', () => {
  for (const source of [
    'try { risky() } catch {}',
    'try { risky() } catch (error) {   }',
    'try { risky() } catch { /**/ }',
    'try { risky() } catch { /*   */ }',
    'try { risky() } catch { //   \n }',
    'try { risky() } catch { /* TODO */ }',
    'try { risky() } catch { // FIXME: handle later\n }',
    'try { risky() } catch { /* eslint-disable no-empty */ }',
    'try { risky() } catch { /* @ts-ignore */ }',
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
    'try { risky() } catch { /* opslag kan geblokkeerd zijn */ }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(source), null, source)
  }
})

test('QA #1000: decorator-prefixed TODO and directive-only catches are still undocumented [expected RED]', () => {
  for (const text of [
    '@TODO: decide later',
    '@FIXME: implement',
    '@ts-nocheck',
    'tslint:disable:no-empty',
    'eslint-enable no-empty',
  ]) {
    const source = `try { risky() } catch { /* ${text} */ }`
    assert.ok(findUndocumentedEmptyCatch(source), text)
  }
})

test('QA #1000: genuine explained best-effort catches stay valid with commented tooling prose elsewhere', () => {
  for (const source of [
    'try { risky() } catch { /* Ignore denied browser storage; continue in memory. */ }',
    'try { risky() } catch { // Fallback to empty checklist because privacy mode blocks storage.\n }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(source), null, source)
  }
})
