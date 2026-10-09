import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const configSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

function propertyKey(property) {
  if (!ts.isPropertyAssignment(property)) return null
  const name = property.name
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

function configObject(source) {
  const file = ts.createSourceFile('vite.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of file.statements) {
    if (!ts.isExportAssignment(statement)) continue
    const call = statement.expression
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'defineConfig') continue
    const value = call.arguments[0]
    if (value && ts.isObjectLiteralExpression(value)) return value
  }
  throw new Error('Vite config must expose a statically inspectable defineConfig object')
}

function staticProperties(object) {
  const map = new Map()
  for (const property of object.properties) {
    const key = propertyKey(property)
    assert.ok(key, 'Vite configuration cannot use dynamic/spread property entries')
    assert.ok(!map.has(key), 'Vite configuration cannot shadow duplicate property: ' + key)
    map.set(key, property.initializer)
  }
  return map
}

function assertLocalNetworkBoundary(source) {
  const root = staticProperties(configObject(source))
  for (const sectionName of ['server', 'preview']) {
    const section = root.get(sectionName)
    if (!section) continue
    assert.ok(ts.isObjectLiteralExpression(section), sectionName + ' must be a static object')
    const options = staticProperties(section)
    const host = options.get('host')
    if (host) {
      assert.ok(ts.isStringLiteral(host) && ['localhost', '127.0.0.1', '::1'].includes(host.text),
        sectionName + '.host cannot expose Supa on the public network')
    }
    const cors = options.get('cors')
    if (cors) assert.equal(cors.kind, ts.SyntaxKind.FalseKeyword, sectionName + '.cors must not be broadly enabled')
    const allowedHosts = options.get('allowedHosts')
    if (allowedHosts) assert.equal(allowedHosts.kind, ts.SyntaxKind.FalseKeyword, sectionName + '.allowedHosts cannot be unrestricted')
  }
}

test('Vite development and preview bind locally without permissive network overrides', () => {
  assert.doesNotThrow(() => assertLocalNetworkBoundary(configSource))
})

test('Vite config regression rejects public binding, broad CORS and host allowlisting', () => {
  for (const bad of [
    'server: { host: true }',
    "server: { host: '0.0.0.0' }",
    "preview: { host: '::' }",
    'preview: { cors: true }',
    'server: { allowedHosts: true }',
    'preview: { ...untrustedSettings }',
    "server: { host: 'localhost', host: '0.0.0.0' }",
  ]) {
    assert.throws(() => assertLocalNetworkBoundary('export default defineConfig({ ' + bad + ' })'), bad)
  }
})

test('Vite config regression preserves explicit loopback addresses and strict preview port', () => {
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    assert.doesNotThrow(() => assertLocalNetworkBoundary(
      "export default defineConfig({ server: { host: '" + host + "' }, preview: { strictPort: true, host: 'localhost' } })",
    ))
  }
})
