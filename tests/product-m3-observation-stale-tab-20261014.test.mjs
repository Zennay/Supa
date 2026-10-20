import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import {
  observationDraftStorageStatus,
} from '../src/features/observation/observationDraftStorageGuard.ts'
import {
  buildObservationSheet,
  OBSERVATION_DRAFT_STORAGE_KEY,
} from '../src/domain/m3ObservationSheet.ts'

function storage(initial = null) {
  const map = new Map(initial === null ? [] : [[OBSERVATION_DRAFT_STORAGE_KEY, initial]])
  const operations = []
  return {
    operations,
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { operations.push(['set', key, value]); map.set(key, value) },
    removeItem(key) { operations.push(['remove', key]); map.delete(key) },
  }
}

test('current M3 draft bytes can be saved without leaking or serializing private fields', () => {
  const first = JSON.stringify(buildObservationSheet())
  const device = storage(first)
  assert.equal(
    observationDraftStorageStatus(() => device, OBSERVATION_DRAFT_STORAGE_KEY, first),
    'unchanged',
  )
  assert.deepEqual(device.operations, [])
})

test('stale tab refuses to overwrite a different concurrently saved 11+11 concept', () => {
  const initial = JSON.stringify(buildObservationSheet())
  const device = storage(initial)
  const otherTab = JSON.stringify({
    ...buildObservationSheet(),
    study: { ...buildObservationSheet().study, studyId: 'private-new-study' },
  })
  device.setItem(OBSERVATION_DRAFT_STORAGE_KEY, otherTab)
  const before = device.operations.length
  assert.equal(
    observationDraftStorageStatus(() => device, OBSERVATION_DRAFT_STORAGE_KEY, initial),
    'changed',
  )
  // The caller can now only show a warning and export its separate in-memory
  // draft: it is not authorized to setItem or removeItem.
  assert.equal(device.operations.length, before)
  assert.equal(device.getItem(OBSERVATION_DRAFT_STORAGE_KEY), otherTab)
  assert.equal(JSON.stringify(buildObservationSheet()).includes('private-new-study'), false)
})

test('a deleted key is a changed draft, not permission to recreate stale observations', () => {
  const initial = JSON.stringify(buildObservationSheet())
  const device = storage(initial)
  device.removeItem(OBSERVATION_DRAFT_STORAGE_KEY)
  const before = device.operations.length
  assert.equal(
    observationDraftStorageStatus(() => device, OBSERVATION_DRAFT_STORAGE_KEY, initial),
    'changed',
  )
  assert.equal(device.operations.length, before)
})

test('a new tab may save only while the key is still truly absent', () => {
  const device = storage()
  assert.equal(
    observationDraftStorageStatus(() => device, OBSERVATION_DRAFT_STORAGE_KEY, null),
    'unchanged',
  )
  device.setItem(OBSERVATION_DRAFT_STORAGE_KEY, JSON.stringify(buildObservationSheet()))
  assert.equal(
    observationDraftStorageStatus(() => device, OBSERVATION_DRAFT_STORAGE_KEY, null),
    'changed',
  )
})

test('unreadable initial snapshot, errors or forged storage values never authorize saving/deleting', () => {
  const device = storage()
  for (const input of [undefined, 0, {}, false]) {
    assert.equal(
      observationDraftStorageStatus(() => device, OBSERVATION_DRAFT_STORAGE_KEY, input),
      'unavailable',
    )
  }
  assert.equal(
    observationDraftStorageStatus(() => { throw Error('private storage failure') },
      OBSERVATION_DRAFT_STORAGE_KEY, null),
    'unavailable',
  )
  assert.equal(
    observationDraftStorageStatus(() => ({ getItem() { throw Error('private data') } }),
      OBSERVATION_DRAFT_STORAGE_KEY, null),
    'unavailable',
  )
  assert.equal(
    observationDraftStorageStatus(() => ({ getItem() { return 3 } }),
      OBSERVATION_DRAFT_STORAGE_KEY, null),
    'unavailable',
  )
  assert.equal(
    observationDraftStorageStatus(() => device, '', null),
    'unavailable',
  )
})

test('M3 form quarantines stale tabs before both writes and destructive deletes', () => {
  const source = readFileSync(
    new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /expectedDraftRawRef\.current = raw/u)
  assert.match(source, /observationDraftStorageStatus\(/u)
  assert.match(source, /if \(status !== 'unchanged'\)/u)
  assert.match(source, /if \(draftRecoveryNeeded\) \{[\s\S]*?if \(draftConflict\)/u)
  assert.match(source, /window\.addEventListener\('storage', onStorage\)/u)
  assert.match(source, /window\.removeEventListener\('storage', onStorage\)/u)
  assert.match(source, /data-observation-save-status="conflict"/u)
  assert.match(source, /if \(status === 'changed'\) setDraftConflict\(true\)/u)
  assert.match(source, /expectedDraftRawRef\.current = null/u)
  assert.ok(source.indexOf('const status = observationDraftStorageStatus(') <
    source.indexOf('!persistObservationDraft('))
  const guardedReset = source.slice(source.indexOf('const clearDraftWithConflictGuard ='), source.indexOf('const jumpToNextIncomplete ='))
  assert.ok(guardedReset.indexOf('observationDraftStorageStatus(') <
    guardedReset.indexOf('if (clearDraft() === true)'))
  assert.ok(guardedReset.includes('setDraftConflict(true)'))
  assert.match(source, /onClick=\{clearDraftWithConflictGuard\}/u)
  // Canonical validation and 22 field slots remain unmodified by this check.
  assert.match(source, /observationSheetReadiness\(sheet, referenceNowMs\)/u)
  assert.match(source, /JSON-concept bewaren/u)
})

test('real M3 observation form SSR still renders user recovery/export affordance', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ObservationView } = await vite.ssrLoadModule('/src/features/observation/ObservationView.tsx')
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.match(html, /Meten zonder gokken/u)
    assert.match(html, /JSON-concept bewaren/u)
    assert.match(html, /PLUS/u)
    assert.match(html, /DekaMarkt/u)
    assert.match(html, /data-observation-save-status="normal"/u)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete globalThis.window
    await vite.close()
  }
})
