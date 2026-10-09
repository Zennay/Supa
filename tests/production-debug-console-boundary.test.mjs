import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const productionRoot = new URL('../src/', import.meta.url)
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const debugMethods = new Set(['log', 'debug', 'info', 'trace', 'dir', 'table'])

function findDebugConsoleCalls(source, filename = 'fixture.tsx') {
  const kind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : filename.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind)
  const findings = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const access = node.expression
      const receiver = access.expression
      if (ts.isIdentifier(receiver) && receiver.text === 'console' && debugMethods.has(access.name.text)) {
        findings.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, method: access.name.text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return findings
}

async function productionFiles(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const next = path.join(relative, entry.name)
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) result.push(...await productionFiles(url, next))
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) result.push({ url, path: next })
  }
  return result
}

test('production code has no debugging console calls that may expose basket or shopper data', async () => {
  const files = await productionFiles(productionRoot)
  assert.ok(files.length > 0, 'expected production source files')
  const findings = []
  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    for (const item of findDebugConsoleCalls(source, file.path)) {
      findings.push(file.path + ':' + item.line + ' console.' + item.method)
    }
  }
  assert.deepEqual(findings, [], 'remove diagnostic console output from production code')
})

test('detects executable diagnostics while ignoring inert text and other methods', () => {
  for (const method of debugMethods) {
    assert.equal(findDebugConsoleCalls('console.' + method + '(basket)')[0]?.method, method)
  }
  assert.deepEqual(findDebugConsoleCalls('// console.log(basket)\nconst text = "console.debug(basket)"'), [])
  assert.deepEqual(findDebugConsoleCalls('console.error("Expected failure")'), [])
  assert.deepEqual(findDebugConsoleCalls('object.log(basket)'), [])
  assert.equal(findDebugConsoleCalls('console.log?.(basket)').length, 1)
})
