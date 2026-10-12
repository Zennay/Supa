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

function hasExplanatoryComment(source, ignoredRanges = []) {
  // Use lexical comment trivia: character sequences that resemble comments
  // inside a string or static template literal are not comments at all.
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source,
  )
  const comments = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia) {
      comments.push({ index: scanner.getTokenPos(), comment: scanner.getTokenText() })
    }
  }

  return comments.some((match) => {
    // Explanations inside a function body that never ran cannot document the
    // outer catch's decision to swallow its exception.
    if (ignoredRanges.some(([start, end]) =>
      match.index >= start && match.index < end)) return false
    const comment = match.comment
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
    if (/^(?:eslint-(?:disable|enable)(?:-next-line|-line)?|tslint(?:-disable|:disable)|@ts-(?:ignore|expect-error|nocheck|check)|biome-ignore|deno-lint-ignore|oxlint-(?:disable|enable)(?:-next-line|-line)?|prettier-ignore)\b/i.test(explanation)) {
      return false
    }
    // A numeric code by itself is not a rationale for discarding a failure.
    // Require at least one word character that is a Unicode letter.
    return /[\p{L}]/u.test(explanation)
  })
}

// Semicolons, debugger pauses and stand-alone literal evaluations do not
// handle an exception. These are syntactic checks only: a call, property
// access, identifier or dynamic template could have effects, so do not guess.
// Pure literal evaluation does not recover from a caught exception. Only
// peel unary syntax when its operand is itself statically inert: 'void fn()',
// '!recover()' and other calls/reads must remain potentially effective.
function isInertCatchExpression(expression) {
  let current = expression
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression
  }

  // Defining an uncalled callback/body is not executing recovery code.
  // Function creation must not make an otherwise empty catch appear handled.
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return true
  }
  if (ts.isVoidExpression(current)) {
    return isInertCatchExpression(current.expression)
  }
  if (ts.isPrefixUnaryExpression(current)) {
    if (![
      ts.SyntaxKind.ExclamationToken,
      ts.SyntaxKind.TildeToken,
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
    ].includes(current.operator)) return false
    // Unary + on a BigInt throws: conservatively treat it as non-inert.
    if (current.operator === ts.SyntaxKind.PlusToken &&
        ts.isBigIntLiteral(current.operand)) return false
    return isInertCatchExpression(current.operand)
  }

  return ts.isStringLiteral(current) ||
    ts.isNumericLiteral(current) ||
    ts.isBigIntLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current) ||
    ts.isRegularExpressionLiteral(current) ||
    current.kind === ts.SyntaxKind.TrueKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword ||
    current.kind === ts.SyntaxKind.NullKeyword
}

function hasEffectiveCatchStatements(statements) {
  return statements.some((statement) => {
    if (ts.isBlock(statement)) {
      return hasEffectiveCatchStatements(statement.statements)
    }
    if (ts.isEmptyStatement(statement) || ts.isDebuggerStatement(statement) ||
        ts.isFunctionDeclaration(statement)) {
      // The function body is inert until a call actually executes it.
      return false
    }
    if (ts.isExpressionStatement(statement) &&
        isInertCatchExpression(statement.expression)) {
      return false
    }
    return true
  })
}

function ignoredDeferredCommentRanges(catchClause, sourceFile, contentStart) {
  const ranges = []
  function visit(node) {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node)) {
      ranges.push([node.getStart(sourceFile) - contentStart,
        node.getEnd() - contentStart])
      return
    }
    ts.forEachChild(node, visit)
  }
  for (const statement of catchClause.block.statements) visit(statement)
  return ranges
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

    if (ts.isCatchClause(node) && !hasEffectiveCatchStatements(node.block.statements)) {
      const contentStart = node.block.getStart(sourceFile) + 1
      const inner = source.slice(contentStart, node.block.getEnd() - 1)
      const ignored = ignoredDeferredCommentRanges(node, sourceFile, contentStart)

      if (!hasExplanatoryComment(inner, ignored)) {
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
