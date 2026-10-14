import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { OBSERVATION_DRAFT_STORAGE_KEY } from '../src/domain/m3ObservationSheet.ts'

const source = readFileSync(new URL(
  '../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler
function locate(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'downloadUnrecognizedDraft') {
    handler = node.initializer
  }
  ts.forEachChild(node, locate)
}
locate(file)
assert.ok(handler && ts.isArrowFunction(handler),
  'test must call the real browser recovery handler')
const compiled = ts.transpileModule(
  'const action = ' + handler.getText(file) + '; module.exports = action',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

function attempt({ failAt = null } = {}) {
  const original = '{"schemaVersion":999,"opaqueUserDraft":"synthetic-private-observation"}'
  const calls = []
  const downloads = []
  let status
  const storage = {
    getItem(key) {
      assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
      calls.push('read-existing')
      if (failAt === 'read') throw new Error('read denied')
      return original
    },
    removeItem() { assert.fail('downloading must not remove existing local observations') },
    setItem() { assert.fail('downloading must not rewrite existing local observations') },
  }
  const urlApi = {
    createObjectURL(blob) {
      calls.push('create-url')
      downloads.push(blob)
      if (failAt === 'url') throw new Error('blob unavailable')
      return 'blob:private'
    },
    revokeObjectURL(url) {
      assert.equal(url, 'blob:private')
      calls.push('revoke-url')
    },
  }
  const browserDocument = {
    createElement(tag) {
      assert.equal(tag, 'a')
      return {
        set href(value) { assert.equal(value, 'blob:private') },
        set download(value) { assert.equal(value, 'supa-m3-lokaal-herstelorigineel.txt') },
        click() { calls.push('click'); if (failAt === 'click') throw new Error('blocked') },
        remove() { calls.push('remove-anchor') },
      }
    },
    body: { append() { calls.push('append') } },
  }
  const module = { exports: null }
  new Function(
    'module', 'window', 'URL', 'document', 'Blob', 'OBSERVATION_DRAFT_STORAGE_KEY', 'setImportStatus',
    compiled,
  )(module, { localStorage: storage }, urlApi, browserDocument, Blob,
    OBSERVATION_DRAFT_STORAGE_KEY, result => { status = result; calls.push('status-' + result.kind) })
  return { original, run: () => module.exports(), state: () => ({ status, calls, downloads }) }
}

test('M3 user-initiated backup reads only on-device original bytes and never promises disk success', async () => {
  const run = attempt()
  run.run()
  const { status, calls, downloads } = run.state()
  assert.equal(status.kind, 'success')
  assert.match(status.message, /Download.+gestart/)
  assert.match(status.message, /Controleer of het bestand echt is opgeslagen/)
  assert.deepEqual(calls, [
    'read-existing', 'create-url', 'append', 'click',
    'status-success', 'remove-anchor', 'revoke-url',
  ])
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].type, 'application/octet-stream')
  assert.equal(await downloads[0].text(), run.original)
})

for (const failAt of ['read', 'url', 'click']) {
  test('original M3 recovery export handles ' + failAt + ' failure without deleting raw evidence', () => {
    const run = attempt({ failAt })
    run.run()
    const { status, calls } = run.state()
    assert.equal(status.kind, 'error')
    assert.match(status.message, /niet verwijderd/)
    assert.equal(calls.includes('status-success'), false)
    if (failAt === 'click') {
      assert.ok(calls.includes('remove-anchor'))
      assert.ok(calls.includes('revoke-url'))
    }
    if (failAt === 'read') {
      assert.equal(calls.includes('create-url'), false)
    }
  })
}
