import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent add-only QA #1737 acceptance: different synthetic variants than
// the expected-RED input set. No actual names, retailer observations or PII.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function verify(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-typographic-independent-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3/baskets/private'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Disposable synthetic control\n')
    const evidence = join(root, 'evidence/m3/baskets/private/note.md')
    writeFileSync(evidence, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null)
    assert.equal(readFileSync(evidence, 'utf8'), markdown, 'temporary scan cannot mutate source bytes')
    return { code: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [name, note] of [
  ['nonbreaking hyphen in Dutch e-mail-adres', 'e\u2011mail\u2011adres = fictional-value-1'],
  ['figure dash in account-email HTML cell', '<th>account\u2012email</th><td>fictional-value-2</td>'],
  ['minus sign in full-name quoted list', '- "full\u2212name": fictional-value-3'],
  ['en dash in participant-name bold label', '**participant\u2013name**: fictional-value-4'],
  ['hyphen in Dutch naam-deelnemer definition', '<dt>naam\u2010deelnemer</dt><dd>fictional-value-5</dd>'],
  ['nonbreaking hyphen in participant-email table', '| participant\u2011email | fictional-value-6 |'],
  ['minus sign in account-id heading', '### account\u2212id: fictional-value-7'],
]) {
  test('QA #1737 independent typographic acceptance: ' + name, () => {
    const result = verify(note)
    assert.equal(result.code, 1, 'missed fictional direct identifier: ' + name + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1737 independent separator controls allow normal basket metadata', () => {
  for (const note of [
    'e\u2011mail\u2011policy: never collect addresses',
    '<th>product\u2012name</th><td>carrots</td>',
    '- "recipe\u2212name": lentils',
    '**ingredient\u2013name**: oats',
    '<dt>basket\u2010reference</dt><dd>synthetic</dd>',
    '| store\u2011name | PLUS |',
    '### comparison\u2212id: week-1',
    'participantKey: synthetic-pseudonym-7',
    'M3 evidence must exclude explicit names, emails and phone numbers.',
  ]) {
    const result = verify(note)
    assert.equal(result.code, 0, 'safe synthetic text was rejected: ' + note + '\n' + result.output)
  }
})
