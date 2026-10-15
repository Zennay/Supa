import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { renderM3PaperChecklist as nodeRenderer } from '../scripts/m3-print-field-checklist.mjs'
import { renderM3PaperChecklist as browserRenderer } from '../src/features/observation/m3PaperWorksheet.ts'
import { downloadBlankM3PaperWorksheet } from '../src/features/observation/downloadBlankM3PaperWorksheet.ts'

test('M3 paper Node CLI and browser produce exact same deterministic blank 11 PLUS + 11 Deka HTML', () => {
  const before = structuredClone(buildObservationSheet())
  const fromCli = nodeRenderer()
  const fromBrowser = browserRenderer()
  assert.equal(fromCli, fromBrowser)
  assert.equal((fromBrowser.match(/data-m3-side="baseline"/g) ?? []).length, 1)
  assert.equal((fromBrowser.match(/data-m3-side="candidate"/g) ?? []).length, 1)
  assert.equal((fromBrowser.match(/data-m3-row="/g) ?? []).length, 22)
  assert.equal((fromBrowser.match(/☐ ja ☐ nee ☐ onbekend/g) ?? []).length, 22)
  assert.equal((fromBrowser.match(/Codeversie \(SHA-40, door operator opgegeven\)/g) ?? []).length, 2)
  assert.match(fromBrowser, /@page\{size:A4 landscape;margin:10mm\}/)
  assert.doesNotMatch(fromBrowser, /https?:\/\/(?:plus|dekamarkt)\.nl|<script\b|€\s*\d+[.,]\d{2}/i)
  assert.deepEqual(buildObservationSheet(), before)
})

test('M3 renderer preserves the explicitly supplied SHA on both paper pages with strict validation', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567'
  assert.equal(browserRenderer(sha), nodeRenderer(sha))
  assert.equal(browserRenderer(sha).split(sha).length - 1, 2)
  assert.throws(() => browserRenderer('HEAD'), /Invalid M3 field-run commit SHA/)
  assert.throws(() => browserRenderer('A'.repeat(40)), /Invalid M3 field-run commit SHA/)
})

test('M3 browser download starts a user-local blank HTML file, revokes URL and does not inspect draft', async () => {
  const oldDocument = globalThis.document
  const create = URL.createObjectURL
  const revoke = URL.revokeObjectURL
  let blob
  let clicked = 0
  let removed = 0
  let revoked = ''
  let appended = 0
  const anchor = {
    href: '', download: '',
    click() { clicked += 1 },
    remove() { removed += 1 },
  }
  try {
    globalThis.document = {
      createElement(name) {
        assert.equal(name, 'a')
        return anchor
      },
      body: { append(value) { assert.equal(value, anchor); appended += 1 } },
      // Any use of private localStorage must abort immediately.
      get localStorage() { throw new Error('private draft accessed') },
    }
    URL.createObjectURL = (value) => {
      blob = value
      return 'blob:local-worksheet'
    }
    URL.revokeObjectURL = (url) => { revoked = url }
    assert.equal(downloadBlankM3PaperWorksheet(), true)
    assert.equal(clicked, 1)
    assert.equal(removed, 1)
    assert.equal(appended, 1)
    assert.equal(anchor.download, 'supa-m3-leeg-plus-dekamarkt-veldformulier.html')
    assert.equal(anchor.href, 'blob:local-worksheet')
    assert.equal(revoked, anchor.href)
    assert.equal(blob.type, 'text/html;charset=utf-8')
    assert.equal(await blob.text(), browserRenderer())
  } finally {
    globalThis.document = oldDocument
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
  }
})

test('M3 browser download failure stays private and UI exposes only explicit user action', async () => {
  const oldDocument = globalThis.document
  const create = URL.createObjectURL
  const revoke = URL.revokeObjectURL
  let appended = 0
  try {
    globalThis.document = {
      createElement() { throw new Error('should not allocate anchor') },
      body: { append() { appended++ } },
      get localStorage() { throw new Error('private draft read') },
    }
    URL.createObjectURL = () => { throw new Error('denied blob permission') }
    URL.revokeObjectURL = () => { throw new Error('should not revoke never-created URL') }
    assert.equal(downloadBlankM3PaperWorksheet(), false)
    assert.equal(appended, 0)
  } finally {
    globalThis.document = oldDocument
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
  }
  const view = await readFile(new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
  assert.match(view, /data-observation-paper-worksheet/)
  assert.match(view, /onClick=\{downloadPaperWorksheet\}/)
  assert.match(view, /downloadBlankM3PaperWorksheet\(paperRevision\)/)
  assert.match(view, /data-observation-paper-revision/)
  assert.match(view, /maxLength=\{40\}/)
  assert.match(view, /Codeversie ongeldig/)
  assert.match(view, /geen meetbewijs/i)
})

test('explicit user-supplied commit SHA is printed twice and unsafe revisions refuse browser download', async () => {
  const previousDocument = globalThis.document
  const create = URL.createObjectURL
  const revoke = URL.revokeObjectURL
  const sha = 'abcdef0123456789abcdef0123456789abcdef01'
  let captured = null
  let count = 0
  const anchor = { href: '', download: '', click() { count++ }, remove() {} }
  try {
    globalThis.document = {
      createElement() { return anchor },
      body: { append() {} },
      get localStorage() { throw new Error('source draft is private') },
    }
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:sha-paper' }
    URL.revokeObjectURL = () => {}
    assert.equal(downloadBlankM3PaperWorksheet(sha), true)
    assert.equal(count, 1)
    assert.equal((await captured.text()).split(sha).length - 1, 2)
    assert.equal(downloadBlankM3PaperWorksheet('HEAD'), false)
    assert.equal(downloadBlankM3PaperWorksheet('0'.repeat(39)), false)
    assert.equal(count, 1, 'invalid revision never creates or clicks an extra download')
  } finally {
    globalThis.document = previousDocument
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
  }
})
