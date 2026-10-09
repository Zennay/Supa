import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const packageText = readFileSync(new URL('../package.json', import.meta.url), 'utf8')

function duplicateScriptKeys(source) {
  const parsed = ts.parseJsonText('package.json', source)
  assert.equal(parsed.parseDiagnostics.length, 0, 'package.json must parse without errors')
  const root = parsed.statements[0]?.expression
  assert.ok(root && ts.isObjectLiteralExpression(root), 'package.json must be an object')
  const scripts = root.properties.find(
    (entry) => ts.isPropertyAssignment(entry) && entry.name.text === 'scripts',
  )
  assert.ok(scripts && ts.isObjectLiteralExpression(scripts.initializer), 'scripts must be an object')

  const seen = new Set()
  const duplicates = []
  for (const property of scripts.initializer.properties) {
    assert.ok(ts.isPropertyAssignment(property), 'scripts entries must be key/value pairs')
    const name = property.name.text
    assert.equal(typeof name, 'string', 'script keys must be static strings')
    if (seen.has(name)) duplicates.push(name)
    seen.add(name)
  }
  return duplicates
}

test('package scripts cannot silently override a duplicate JSON key', () => {
  assert.deepEqual(duplicateScriptKeys(packageText), [])
})

test('package scripts duplicate-key guard rejects overwritten npm commands', () => {
  const modified = packageText.replace(
    '"scripts": {',
    '"scripts": { "test": "node --version",',
  )
  assert.notEqual(modified, packageText, 'fixture must insert a duplicate script')
  assert.deepEqual(duplicateScriptKeys(modified), ['test'])
})
