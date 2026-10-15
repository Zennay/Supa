import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main, renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

const revision = '0123456789abcdef0123456789abcdef01234567'

test('both offline M3 paper sheets visibly carry the exact operator-supplied 40-hex revision', () => {
  const before = renderM3PaperChecklist()
  const pinned = renderM3PaperChecklist(revision)
  assert.equal((pinned.match(/Codeversie \(SHA-40, door operator opgegeven\)/g) || []).length, 2)
  assert.equal(pinned.split(revision).length - 1, 2)
  assert.equal((pinned.match(/data-m3-row="/g) || []).length, 22)
  assert.equal((pinned.match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 22)
  assert.match(before, /Codeversie \(SHA-40, door operator opgegeven\): _+/)
  assert.doesNotMatch(before, /0123456789abcdef/)
  assert.equal(renderM3PaperChecklist(), before)
  assert.doesNotMatch(pinned, /<script\b|https?:\/\/(?:plus|dekamarkt)\.nl|€\s*\d+[.,]\d{2}/i)
})

test('M3 paper revision rejects guessed, noncanonical and forged code identity', () => {
  for (const invalid of [
    undefined, null, 3, 'HEAD', 'main', 'a'.repeat(39), 'a'.repeat(41),
    'A'.repeat(40), 'g'.repeat(40), 'a'.repeat(40) + '\n',
    '<img src=x onerror=alert(1)>', ' '.repeat(40),
  ]) {
    // Undefined is the supported default (blank paper only).
    if (invalid === undefined) continue
    assert.throws(() => renderM3PaperChecklist(invalid), /Invalid M3 field-run commit SHA/)
  }
})

test('CLI records the same explicit revision on both sheets without clobbering private output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-paper-pin-'))
  const output = join(directory, 'worksheet.html')
  const second = join(directory, 'worksheet-other-order.html')
  try {
    await main(['--field-run-sha', revision, '--output', output])
    const html = await readFile(output, 'utf8')
    assert.equal(html.split(revision).length - 1, 2)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    await assert.rejects(main(['--output', output, '--field-run-sha', revision]))
    assert.equal(await readFile(output, 'utf8'), html)
    await main(['--output', second, '--field-run-sha', revision])
    assert.equal(await readFile(second, 'utf8'), html)
    for (const args of [
      ['--field-run-sha', 'HEAD', '--output', join(directory, 'invalid.html')],
      ['--field-run-sha', revision, '--field-run-sha', revision],
      ['--field-run-sha', revision, '--output', output, '--output', second],
      ['--output', output, '--garbage', 'foo'],
      ['--field-run-sha'],
    ]) {
      await assert.rejects(main(args))
    }
    await assert.rejects(stat(join(directory, 'invalid.html')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
