import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import {
  OBSERVATION_DRAFT_STORAGE_KEY,
  buildObservationSheet,
} from '../src/domain/m3ObservationSheet.ts'
import { removeObservationDraft } from '../src/features/observation/observationDraftPersistence.ts'

// This QA executes the *actual* two recovery handlers in ObservationView.tsx,
// extracted via AST, rather than a copy of the intended logic. Every byte of
// "old draft" below is synthetic and deliberately not a valid M3 study.
const source = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
)
const tree = ts.createSourceFile('ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function loadArrow(name, parameters) {
  let expression
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) {
      assert.equal(expression, undefined, name + ' must have one owner')
      expression = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(expression && ts.isArrowFunction(expression), 'actual handler missing: ' + name)
  return new Function(...parameters, 'return (' + expression.getText(tree) + ')')
}

const makeReset = loadArrow('clearUnrecognizedDraft', [
  'recoveryResetArmed', 'setRecoveryResetArmed', 'setImportStatus',
  'removeObservationDraft', 'window', 'OBSERVATION_DRAFT_STORAGE_KEY',
  'setSheet', 'buildObservationSheet', 'setPendingImport',
  'setDraftRecoveryNeeded', 'setDraftResetRemovalFailed',
])
const makeDownload = loadArrow('downloadUnrecognizedDraft', [
  'window', 'OBSERVATION_DRAFT_STORAGE_KEY', 'URL', 'Blob', 'document', 'setImportStatus',
])

const RAW = JSON.stringify({
  schemaVersion: 99,
  study: { studyId: 'synthetic-unsupported-study', participantKey: 'private-fake-marker-only' },
  baseline: { marker: '22 controlled unavailable items' },
  deliberatelyUnknownSchema: { preserveOriginal: true },
})

function harness({ removalDenied = false, accessDenied = false } = {}) {
  let bytes = RAW
  let armed = false
  let state = buildObservationSheet()
  let pendingImport = { kind: 'synthetic-import-staged' }
  let recoveryNeeded = true
  let resetWarning = true
  let status = null
  let removeCalls = 0
  let writes = 0
  const events = []
  const localStorage = {
    getItem(key) { assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY); return bytes },
    removeItem(key) {
      assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
      removeCalls++
      if (removalDenied) throw new Error('denied')
      bytes = null
    },
    setItem(key, value) {
      assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
      writes++
      bytes = value
    },
  }
  const browser = accessDenied
    ? Object.defineProperty({}, 'localStorage', { get() { throw new Error('not allowed') } })
    : { localStorage }
  function click() {
    makeReset(
      armed,
      value => { events.push('arm'); armed = value },
      value => { events.push('status'); status = value },
      removeObservationDraft, browser, OBSERVATION_DRAFT_STORAGE_KEY,
      value => { events.push('reset-sheet'); state = value },
      buildObservationSheet,
      value => { events.push('clear-import'); pendingImport = value },
      value => { events.push('recovery'); recoveryNeeded = value },
      value => { events.push('reset-warning'); resetWarning = value },
    )()
  }
  return {
    click, browser, localStorage, events,
    snapshot: () => ({
      bytes, armed, state, pendingImport, recoveryNeeded, resetWarning,
      status, removeCalls, writes,
    }),
  }
}

for (const [name, options] of [
  ['removeItem denied', { removalDenied: true }],
  ['localStorage getter denied', { accessDenied: true }],
]) {
  test('QA M3 original unsupported draft: ' + name +
    ' never clears original bytes or enables unsafe autosave', () => {
    const run = harness(options)
    const initial = run.snapshot()
    run.click()
    const first = run.snapshot()
    assert.equal(first.armed, true)
    assert.equal(first.removeCalls, 0)
    assert.equal(first.status.kind, 'warning')
    assert.equal(first.bytes, RAW)
    run.click()
    const failed = run.snapshot()
    assert.equal(failed.armed, false)
    assert.equal(failed.status.kind, 'error')
    assert.match(failed.status.message, /bestaande lokale concept is behouden/)
    assert.equal(failed.bytes, RAW)
    assert.strictEqual(failed.state, initial.state)
    assert.deepEqual(failed.pendingImport, initial.pendingImport)
    assert.equal(failed.recoveryNeeded, true)
    assert.equal(failed.resetWarning, true)
    assert.equal(failed.writes, 0)
    assert.equal(run.events.includes('reset-sheet'), false)
    assert.equal(run.events.includes('clear-import'), false)
    assert.equal(run.events.includes('recovery'), false)
  })
}

test('QA M3 original unsupported draft: two-step successful removal changes state only after delete', () => {
  const run = harness()
  run.click()
  assert.equal(run.snapshot().removeCalls, 0)
  run.click()
  const after = run.snapshot()
  assert.equal(after.removeCalls, 1)
  assert.equal(after.bytes, null)
  assert.equal(after.writes, 0)
  assert.equal(after.recoveryNeeded, false)
  assert.equal(after.resetWarning, false)
  assert.equal(after.armed, false)
  assert.equal(after.pendingImport, null)
  assert.deepEqual(after.state, buildObservationSheet())
  assert.equal(after.status.kind, 'success')
  assert.match(after.status.message, /geen besparingsbewijs/)
  assert.ok(run.events.indexOf('reset-sheet') > run.events.indexOf('arm'))
})

for (const failure of ['getItem throws', 'object URL creation throws', 'anchor append throws']) {
  test('QA M3 recovery download ' + failure +
    ' retains original storage and never claims a backup', () => {
    const run = harness()
    let appended = 0
    let revoked = 0
    let created = 0
    let status = null
    const u = {
      createObjectURL() {
        created++
        if (failure === 'object URL creation throws') throw new Error('blob denied')
        return 'blob:synthetic-private-backup'
      },
      revokeObjectURL(href) {
        assert.equal(href, 'blob:synthetic-private-backup')
        revoked++
      },
    }
    const document = {
      createElement() {
        return { href: '', download: '', click() { assert.fail('no backup on failure') }, remove() {} }
      },
      body: { append() {
        if (failure === 'anchor append throws') throw new Error('denied append')
        appended++
      } },
    }
    const browser = failure === 'getItem throws'
      ? { localStorage: { getItem() { throw new Error('denied read') } } }
      : run.browser
    makeDownload(browser, OBSERVATION_DRAFT_STORAGE_KEY, u, Blob, document,
      value => { status = value })()
    assert.equal(status.kind, 'error')
    assert.equal(run.snapshot().bytes, RAW)
    assert.equal(run.snapshot().removeCalls, 0)
    assert.equal(run.snapshot().writes, 0)
    assert.equal(revoked, failure === 'anchor append throws' ? 1 : 0)
    assert.equal(appended, 0)
  })
}

test('QA M3 recovery export downloads byte-identical unsupported draft and revokes object URL', async () => {
  const run = harness()
  let backup
  let clickCount = 0
  let revokeCount = 0
  let status = null
  const u = {
    createObjectURL(blob) { backup = blob; return 'blob:local-only-qa' },
    revokeObjectURL(href) {
      assert.equal(href, 'blob:local-only-qa')
      revokeCount++
    },
  }
  const anchor = {
    href: '', download: '',
    click() {
      clickCount++
      assert.equal(this.href, 'blob:local-only-qa')
      assert.equal(this.download, 'supa-m3-lokaal-herstelorigineel.txt')
    },
    remove() { this.removed = true },
  }
  const document = {
    createElement(tag) { assert.equal(tag, 'a'); return anchor },
    body: { append(value) { assert.strictEqual(value, anchor) } },
  }
  makeDownload(run.browser, OBSERVATION_DRAFT_STORAGE_KEY, u, Blob, document,
    value => { status = value })()
  assert.ok(backup instanceof Blob)
  assert.equal(backup.type, 'application/octet-stream')
  assert.equal(await backup.text(), RAW, 'offline backup must preserve every original byte')
  assert.equal(status.kind, 'success')
  assert.equal(clickCount, 1)
  assert.equal(revokeCount, 1)
  assert.equal(anchor.removed, true)
  assert.equal(run.snapshot().bytes, RAW)
  assert.equal(run.snapshot().removeCalls, 0)
  assert.equal(run.snapshot().writes, 0)
  assert.equal(run.snapshot().recoveryNeeded, true,
    'downloading does not automatically authorize deletion or saving over unsupported data')
})
