import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.ts', '.tsx'])
const forbiddenDirective = /@ts-(?:ignore|nocheck)\b/

function scriptLanguageVariant(filename) {
  return path.extname(filename) === '.tsx'
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard
}

function findSilentTypeScriptSuppression(source, filename = 'candidate.ts') {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    scriptLanguageVariant(filename),
    source,
  )

  while (true) {
    const token = scanner.scan()
    if (token === ts.SyntaxKind.EndOfFileToken) return null

    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue
    }

    const text = scanner.getTokenText()
    const match = text.match(forbiddenDirective)
    if (!match) continue

    const position = scanner.getTokenPos() + (match.index ?? 0)
    const prefix = source.slice(0, position)
    const line = prefix.split(/\r?\n/).length

    return {
      directive: match[0],
      line,
      text,
    }
  }
}

async function listTypeScriptSources(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listTypeScriptSources(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('suppression guard catches silent TypeScript directives in comments', () => {
  for (const [source, directive] of [
    ['// @ts-ignore\nconst value = unsafe()', '@ts-ignore'],
    ['/* @ts-nocheck */\nconst value = unsafe()', '@ts-nocheck'],
    ['// explanation @ts-ignore: legacy path\nrun()', '@ts-ignore'],
    ['/**\n * @ts-nocheck\n */\nrun()', '@ts-nocheck'],
  ]) {
    assert.equal(
      findSilentTypeScriptSuppression(source)?.directive,
      directive,
      source,
    )
  }
})

test('suppression guard preserves compiler-verified and inert text', () => {
  for (const source of [
    '// @ts-expect-error upstream typing regression\nconst value = unsafe()',
    "const example = '@ts-ignore'",
    'const template = `@ts-nocheck`',
    'const clean = true',
  ]) {
    assert.equal(findSilentTypeScriptSuppression(source), null, source)
  }
})

test('production TypeScript contains no silent suppression directives', async () => {
  const files = await listTypeScriptSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production TypeScript file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findSilentTypeScriptSuppression(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden ' +
        (finding?.directive ?? 'TypeScript suppression') + ' at line ' +
        (finding?.line ?? '?') + ': ' + (finding?.text ?? 'unknown comment'),
    )
  }
})
