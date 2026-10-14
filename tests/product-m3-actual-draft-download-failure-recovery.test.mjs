import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

const source = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)
const file = ts.createSourceFile('ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let initializer
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'downloadDraft') {
    assert.equal(initializer, undefined, 'one genuine JSON download handler')
    initializer = node.initializer
  }
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(initializer && ts.isArrowFunction(initializer), 'test exercises the actual UI export function')
const compiled = ts.transpileModule(
  'const handler = ' + initializer.getText(file) + '; module.exports = handler',
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  },
)
assert.deepEqual(compiled.diagnostics, [])

function scenario({ failAt = null } = {}) {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'synthetic-field-01'
  sheet.baseline.lines[0].observedProduct.available = false
  const snapshot = structuredClone(sheet)
  const events = []
  const urls = []
  const blobs = []
  let status
  let fileName
  let reference
  const browserURL = {
    createObjectURL(blob) {
      events.push('create-url')
      if (failAt === 'url') throw new Error('browser URL denied')
      blobs.push(blob)
      return 'blob:local-only-token'
    },
    revokeObjectURL(href) {
      events.push('revoke-url')
      urls.push(href)
    },
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'a')
      events.push('create-anchor')
      const anchor = {
        set download(value) { fileName = value },
        set href(value) { reference = value },
        click() {
          events.push('click')
          if (failAt === 'click') throw new Error('browser blocked download')
        },
        remove() { events.push('remove-anchor') },
      }
      return anchor
    },
    body: {
      append(anchor) {
        assert.ok(anchor)
        events.push('append-anchor')
        if (failAt === 'append') throw new Error('DOM unavailable')
      },
    },
  }
  const module = { exports: null }
  new Function(
    'module', 'URL', 'document', 'Blob', 'safeFilePart', 'sheet', 'setImportStatus',
    compiled.outputText,
  )(module, browserURL, document, Blob, value => value, sheet, value => {
    status = value
    events.push('status-' + value.kind)
  })
  assert.equal(typeof module.exports, 'function')
  return {
    run: () => module.exports(),
    state: () => ({ sheet, snapshot, events, urls, blobs, status, fileName, reference }),
  }
}

test('actual M3 JSON export offers only local synthetic 11+11 draft, with honest status and cleanup', async () => {
  const run = scenario()
  run.run()
  const { sheet, snapshot, events, urls, blobs, status, fileName, reference } = run.state()
  assert.equal(status.kind, 'success')
  assert.match(status.message, /Download.+gestart/)
  assert.match(status.message, /Controleer of het bestand echt is opgeslagen/)
  assert.deepEqual(events, [
    'create-url', 'create-anchor', 'append-anchor', 'click',
    'status-success', 'remove-anchor', 'revoke-url',
  ])
  assert.deepEqual(urls, ['blob:local-only-token'])
  assert.equal(reference, 'blob:local-only-token')
  assert.equal(fileName, 'supa-m3-observation-synthetic-field-01.json')
  assert.equal(blobs.length, 1)
  assert.equal(blobs[0].type, 'application/json')
  const originalFile = await blobs[0].text()
  assert.ok(originalFile.endsWith('\n'))
  assert.deepEqual(JSON.parse(originalFile), sheet)
  assert.deepEqual(sheet, snapshot)
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
})

for (const failAt of ['url', 'append', 'click']) {
  test('actual M3 export reports browser ' + failAt + ' refusal without wiping observations', () => {
    const run = scenario({ failAt })
    run.run()
    const { sheet, snapshot, events, urls, status } = run.state()
    assert.equal(status.kind, 'error')
    assert.match(status.message, /ingevulde meting is behouden/)
    assert.match(status.message, /probeer opnieuw/)
    assert.deepEqual(sheet, snapshot)
    assert.equal(events.includes('status-success'), false)
    assert.equal(events.includes('status-error'), true)
    if (failAt === 'url') {
      assert.deepEqual(urls, [])
      assert.equal(events.includes('append-anchor'), false)
    } else {
      assert.deepEqual(urls, ['blob:local-only-token'])
      assert.equal(events.includes('remove-anchor'), true,
        'a partially started browser download still revokes URL and removes transient anchor')
    }
  })
}

test('download remains user initiated, not triggered by M3 next action navigation', () => {
  assert.match(source, /data-observation-export-target onClick=\{downloadDraft\}/)
  assert.match(source, /const downloadDraft = \(\) =>/)
  assert.match(source, /const exportButton = document\.querySelector/)
  assert.match(source, /exportButton\?\.focus\(\{ preventScroll: true \}\)/)
  assert.doesNotMatch(source, /downloadDraft\(\)/)
  assert.doesNotMatch(source, /window\.location\s*=|sendBeacon\(/)
})
