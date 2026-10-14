import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildObservationSheet, OBSERVATION_DRAFT_STORAGE_KEY } from '../src/domain/m3ObservationSheet.ts'
import { observationDraftStorageStatus } from '../src/features/observation/observationDraftStorageGuard.ts'

// Independent post-product acceptance, all fictional offline 11+11 drafts.
// These tests never load a retailer site or interpret prices as measured data.
const key = OBSERVATION_DRAFT_STORAGE_KEY

function writtenSheet(label) {
  const sheet = buildObservationSheet()
  sheet.study.studyId = label
  return JSON.stringify(sheet)
}

function fakeStorage(initial = null) {
  const writes = []
  const data = new Map(initial === null ? [] : [[key, initial]])
  return {
    writes,
    getItem(k) { assert.equal(k, key); return data.has(k) ? data.get(k) : null },
    setItem(k, raw) { assert.equal(k, key); writes.push(['save', raw]); data.set(k, raw) },
    removeItem(k) { assert.equal(k, key); writes.push(['delete']); data.delete(k) },
  }
}

// Model the caller's documented authorization rule, not a magic atomic CAS:
// the actual view is separately asserted to check before both operations.
function attempt(storage, expected, action, raw) {
  const status = observationDraftStorageStatus(() => storage, key, expected)
  if (status !== 'unchanged') return { status, saved: false, expected }
  if (action === 'save') storage.setItem(key, raw)
  else storage.removeItem(key)
  return { status, saved: true, expected: action === 'save' ? raw : null }
}

test('two tabs: stale full-sheet autosave cannot replace newer 11+11 draft', () => {
  const original = writtenSheet('fictional-initial-draft')
  const tabAChange = writtenSheet('fictional-A-update')
  const tabBChange = writtenSheet('fictional-B-update')
  const storage = fakeStorage(original)
  const tabA = attempt(storage, original, 'save', tabAChange)
  assert.deepEqual({ status: tabA.status, saved: tabA.saved }, { status: 'unchanged', saved: true })
  const earlierWrites = storage.writes.length
  const tabB = attempt(storage, original, 'save', tabBChange)
  assert.deepEqual({ status: tabB.status, saved: tabB.saved }, { status: 'changed', saved: false })
  assert.equal(storage.writes.length, earlierWrites)
  assert.equal(storage.getItem(key), tabAChange)
  assert.equal(tabB.expected, original)
  assert.notEqual(tabBChange, tabAChange)
})

test('stale confirmed reset cannot erase newer draft; successful own reset remains legal', () => {
  const original = writtenSheet('fictional-before-reset')
  const updated = writtenSheet('fictional-from-another-tab')
  const storage = fakeStorage(original)
  storage.setItem(key, updated)
  const n = storage.writes.length
  const refused = attempt(storage, original, 'delete')
  assert.equal(refused.saved, false)
  assert.equal(refused.status, 'changed')
  assert.equal(storage.writes.length, n)
  assert.equal(storage.getItem(key), updated)
  const own = attempt(storage, updated, 'delete')
  assert.equal(own.saved, true)
  assert.equal(own.expected, null)
  assert.equal(storage.getItem(key), null)
})

test('missing-key ABA: another tab inserts then clears cannot authorize stale save without a new read', () => {
  // Pure localStorage has no atomic compare-and-swap. Test only observable
  // conflicts at the moment of the prewrite read, not impossible locking.
  const storage = fakeStorage(null)
  const captured = null
  const first = writtenSheet('fictional-tab-1')
  storage.setItem(key, first)
  const refused = attempt(storage, captured, 'save', writtenSheet('fictional-tab-2'))
  assert.equal(refused.status, 'changed')
  assert.equal(refused.saved, false)
  assert.equal(storage.getItem(key), first)
  // A separate later change to null also differs from an old non-null basis.
  storage.removeItem(key)
  assert.equal(observationDraftStorageStatus(() => storage, key, first), 'changed')
})

test('same JSON meaning with changed raw bytes is a conflict, never a parsed-object comparison', () => {
  const a = '{"studyId":"fictional","lines":[]}'
  const b = '{ "lines": [], "studyId": "fictional" }'
  assert.deepEqual(JSON.parse(a), JSON.parse(b))
  const storage = fakeStorage(b)
  assert.equal(observationDraftStorageStatus(() => storage, key, a), 'changed')
  assert.deepEqual(storage.writes, [])
})

test('unknown private schema and empty bytes do not become an implicit overwrite grant', () => {
  const device = fakeStorage('{"schemaVersion":2999,"participantKey":"fictional-secret"}')
  assert.equal(observationDraftStorageStatus(() => device, key, null), 'changed')
  assert.equal(observationDraftStorageStatus(() => device, key, undefined), 'unavailable')
  // Guard only recognizes original bytes: unreadable schemas remain blocked by
  // the view's separate draftRecoveryNeeded branch.
  assert.equal(observationDraftStorageStatus(() => device, key, '{"schemaVersion":2}'), 'changed')
  const empty = fakeStorage('')
  assert.equal(observationDraftStorageStatus(() => empty, key, null), 'changed')
  assert.equal(observationDraftStorageStatus(() => empty, key, ''), 'unchanged')
  assert.deepEqual(device.writes, [])
})

test('denied reads, traps and malformed actual values all abstain without leaking exceptions', () => {
  const privateMessage = 'fictional-private-participant-code'
  const adversaries = [
    () => { throw new Error(privateMessage) },
    () => null,
    () => ({ getItem() { throw new Error(privateMessage) } }),
    () => ({ getItem() { return 42 } }),
    () => new Proxy({}, { get() { throw new Error(privateMessage) } }),
  ]
  for (const getStorage of adversaries) {
    const status = observationDraftStorageStatus(getStorage, key, null)
    assert.equal(status, 'unavailable')
    assert.ok(!status.includes(privateMessage))
  }
  let reads = 0
  assert.equal(observationDraftStorageStatus(() => { reads++; throw new Error('must not read') }, key, undefined), 'unavailable')
  assert.equal(reads, 0, 'missing trusted baseline must not touch private storage')
})

test('M3 stale-tab correction is wired to both save and delete and retains recovery UI', async () => {
  const source = readFileSync(new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
  assert.match(source, /window\.addEventListener\('storage', onStorage\)/u)
  assert.match(source, /window\.removeEventListener\('storage', onStorage\)/u)
  assert.match(source, /event\.key === OBSERVATION_DRAFT_STORAGE_KEY \|\| event\.key === null/u)
  assert.match(source, /data-observation-save-status="conflict"/u)
  assert.match(source, /expectedDraftRawRef\.current = raw/u)
  assert.match(source, /if \(status !== 'unchanged'\)/u)
  const save = source.slice(source.indexOf('  useEffect(() => {\n    if (draftRecoveryNeeded || draftConflict)'), source.indexOf("window.addEventListener('storage', onStorage)"))
  assert.ok(save.indexOf('observationDraftStorageStatus(') >= 0)
  assert.ok(save.indexOf('observationDraftStorageStatus(') < save.indexOf('persistObservationDraft('))
  const clear = source.slice(source.indexOf('  const clearDraft = () =>'), source.indexOf('  const jumpToNextIncomplete ='))
  assert.ok(clear.indexOf('observationDraftStorageStatus(') >= 0)
  assert.ok(clear.indexOf('observationDraftStorageStatus(') < clear.indexOf('removeObservationDraft('))
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ObservationView } = await vite.ssrLoadModule('/src/features/observation/ObservationView.tsx')
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.match(html, /data-observation-save-status="normal"/u)
    assert.match(html, /JSON-concept bewaren/u)
    assert.match(html, /PLUS/u)
    assert.match(html, /DekaMarkt/u)
    assert.doesNotMatch(html, /fictional-private-participant-code/u)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
