import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

const script = fileURLToPath(new URL('../scripts/m3-print-field-checklist.mjs', import.meta.url))
test('22 empty printed rows match the exact canonical 11 demands in both supermarkets', () => {
  const html = renderM3PaperChecklist()
  assert.equal((html.match(/data-m3-row="/g) || []).length, 22)
  assert.match(html, /data-m3-side="baseline"/)
  assert.match(html, /data-m3-side="candidate"/)
  assert.match(html, /PLUS — dezelfde 11 boodschappen/)
  assert.match(html, /DekaMarkt — dezelfde 11 boodschappen/)
  assert.match(html, /@page\{size:A4 landscape/)
  assert.equal(html.split('Week vanaf (maandag)').length - 1, 2)
  assert.equal(html.split('in-store ☐ online-order').length - 1, 2)
  assert.equal(html.split('Herkomst \/ productlink').length - 1, 2)
  assert.match(html, /<html lang="nl">/)
  assert.equal(buildObservationSheet().requirements.length, 11)
  for (const required of buildObservationSheet().requirements) {
    assert.equal(html.split('</strong>').filter((part) =>
      part.endsWith('. ' + required.label)).length, 2, required.label)
  }
  assert.equal(renderM3PaperChecklist(), html)
})
test('blank printout does not include made-up prices, actual user identities, source URLs or active scripts', () => {
  const html = renderM3PaperChecklist()
  assert.match(html, /geen bewijs of besparingsclaim/)
  assert.match(html, /geen naam\/e-mail/)
  assert.match(html, /laat onbekende gegevens leeg/)
  assert.doesNotMatch(html, /€\s*\d+[.,]\d\d/)
  assert.doesNotMatch(html, /https?:\/\/(?:plus|dekamarkt)\.nl/)
  assert.doesNotMatch(html, /<script\b/)
})
test('offline CLI generates mode-0600 HTML but cannot overwrite it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'supa-m3-paper-'))
  const file = path.join(dir, 'private', 'worksheet.html')
  const args = ['--experimental-strip-types', script, '--output', file]
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.equal(await readFile(file, 'utf8'), renderM3PaperChecklist())
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  }
  const repeat = spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(repeat.status, 1)
  assert.equal(await readFile(file, 'utf8'), renderM3PaperChecklist())
  const bad = spawnSync(process.execPath,
    ['--experimental-strip-types', script, '--output', '-unsafe'],
    { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  const stdout = spawnSync(process.execPath,
    ['--experimental-strip-types', script], { encoding: 'utf8' })
  assert.equal(stdout.status, 0, stdout.stderr)
  assert.equal(stdout.stdout, renderM3PaperChecklist())
})
