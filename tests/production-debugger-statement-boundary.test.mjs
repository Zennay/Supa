import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const sourceRoot = new URL('../src/', import.meta.url)
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

function debuggerLocations(source, filename = 'candidate.ts') {
  const ext = path.extname(filename)
  const kind = ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : ext === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind)
  const locations = []
  const visit = (node) => {
    if (ts.isDebuggerStatement(node)) {
      const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file))
      locations.push(`${filename}:${line + 1}:${character + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return locations
}

async function listSources(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) files.push(...await listSources(url, relative))
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push({ relative, url })
  }
  return files
}

test('production source contains no debugger statements', async () => {
  const files = await listSources(sourceRoot)
  assert.ok(files.length > 0, 'expected production source files')
  const findings = []
  for (const file of files) findings.push(...debuggerLocations(await readFile(file.url, 'utf8'), file.relative))
  assert.deepEqual(findings, [], 'remove debugger statements before release')
})

test('debugger AST detection covers blocks, loops and JSX expressions', () => {
  const code = 'function f() { debugger; for (;;) { debugger; break } }'
  assert.equal(debuggerLocations(code).length, 2)
  assert.equal(debuggerLocations('const Component = () => <div>{(() => { debugger; return 1 })()}</div>', 'fixture.tsx').length, 1)
})

test('comments, strings and similarly named properties are inert', () => {
  for (const code of [
    '// debugger;\nconst ok = true',
    'const message = "debugger;"',
    'const value = { debugger: true }; value.debugger',
    '/* debugger; */ function ok() {}',
  ]) assert.deepEqual(debuggerLocations(code), [])
})
