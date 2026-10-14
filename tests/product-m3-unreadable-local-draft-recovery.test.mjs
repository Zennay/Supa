import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  OBSERVATION_DRAFT_STORAGE_KEY,
  buildObservationSheet,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

test('actual Meten screen quarantines unreadable stored observations without treating blank as proof', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ObservationView } = await vite.ssrLoadModule('/src/features/observation/ObservationView.tsx')
    const raw = JSON.stringify({ ...buildObservationSheet(), schemaVersion: 2 })
    assert.equal(restoreObservationSheetDraft(raw), null)
    let writes = 0
    const cases = [
      {
        name: 'future-schema',
        windowValue: { localStorage: {
          getItem(key) { assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY); return raw },
          setItem() { writes += 1 },
        } },
        warning: true,
      },
      {
        name: 'blocked-getter',
        windowValue: Object.defineProperty({}, 'localStorage', {
          get() { throw new Error('storage getter denied') },
        }),
        warning: true,
      },
      {
        name: 'normal-draft',
        windowValue: { localStorage: {
          getItem(key) { assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY); return JSON.stringify(buildObservationSheet()) },
        } },
        warning: false,
      },
      {
        name: 'new-device',
        windowValue: { localStorage: {
          getItem(key) { assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY); return null },
        } },
        warning: false,
      },
    ]

    for (const { name, windowValue, warning } of cases) {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: windowValue })
      const html = renderToStaticMarkup(createElement(ObservationView))
      assert.equal(html.includes('data-observation-recovery-warning'), warning, name)
      assert.equal(html.includes('Ouder lokaal meetconcept niet veilig te lezen'), warning, name)
      assert.equal(html.includes('data-observation-save-status="protected"'), warning, name)
      assert.equal(html.includes('data-observation-save-status="normal"'), !warning, name)
      assert.equal(html.includes('data-observation-save-status="failed"'), false, name)
      if (warning) {
        assert.match(html, /Automatisch bewaren staat uit/)
        assert.doesNotMatch(html, /Je concept wordt automatisch lokaal/)
        assert.match(html, /Nieuwe invoer blijft tijdelijk/)
      } else {
        assert.match(html, /Je concept wordt automatisch lokaal/)
        assert.doesNotMatch(html, /Automatisch bewaren staat uit/)
      }
      assert.equal(html.includes('Bewaar oorspronkelijk lokaal bestand'), warning, name)
      assert.equal(html.includes('Bevestig definitief verwijderen'), false, name)
      assert.equal((html.match(/data-observation-line="/g) ?? []).length, 22)
      assert.doesNotMatch(html, /besparing bewezen|klaar voor publicatie/)
    }
    assert.equal(writes, 0, 'SSR never replaces unsupported stored 11+11 evidence')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})

test('unsupported M3 local drafts cannot be autosaved, imported over, or reset without recovery', async () => {
  const src = await readFile(new URL(
    '../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
  assert.match(src,
    /const \[draftRecoveryNeeded, setDraftRecoveryNeeded\] = useState<boolean>\(\(\) => \{[\s\S]*?restoreObservationSheetDraft\(saved\) === null/)
  assert.match(src,
    /useEffect\(\(\) => \{\s*if \(draftRecoveryNeeded\) \{\s*setDraftPersistenceFailed\(true\)\s*return\s*\}[\s\S]*?observationDraftStorageStatus\([\s\S]*?!persistObservationDraft\(/)
  assert.match(src, /\}, \[sheet, draftRecoveryNeeded\]\)/)
  assert.match(src, /if \(draftRecoveryNeeded\) \{[\s\S]*?Import is gepauzeerd/)
  assert.match(src, /type="file"\s*disabled=\{draftRecoveryNeeded\}/)
  assert.match(src, /onClick=\{clearDraftWithConflictGuard\}\s*disabled=\{draftRecoveryNeeded\}/)
  assert.match(src, /const clearDraftWithConflictGuard = \(\) => \{[\s\S]*?observationDraftStorageStatus\([\s\S]*?if \(draftConflict \|\| status !== 'unchanged'\)[\s\S]*?return[\s\S]*?clearDraft\(\)/)
  assert.match(src, /data-observation-recovery-warning/)
  assert.match(src, /role="alert"/)
  assert.match(src, /const downloadUnrecognizedDraft = \(\) => \{/)
  assert.match(src, /getItem\(OBSERVATION_DRAFT_STORAGE_KEY\)/)
  assert.match(src, /anchor\.download = 'supa-m3-lokaal-herstelorigineel\.txt'/)
  assert.match(src, /const clearUnrecognizedDraft = \(\) => \{[\s\S]*?if \(!recoveryResetArmed\) \{[\s\S]*?return[\s\S]*?const removed = removeObservationDraft\(/)
  assert.match(src, /if \(!removed\) \{[\s\S]*?Verwijderen is geweigerd\.[\s\S]*?return\s*\}[\s\S]*?setSheet\(buildObservationSheet\(\)\)/)
  assert.match(src, /setDraftRecoveryNeeded\(false\)/)
  assert.match(src, /Het scherm is niet leeggemaakt; het eerder opgeslagen lokale concept/)
  assert.doesNotMatch(src, /localStorage\.clear\(\)|sendBeacon\(|fetch\(.*localStorage/)
})
