import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent postrepair acceptance: synthetic M3 privacy cases not reused
// from the separate expected-RED matrix. No real identifiers or field prices.
const guard = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + guard, import.meta.url))
function probe(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-em-dash-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3/field/nested'), { recursive: true })
    copyFileSync(source, join(root, 'tests', guard))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Fictional M3 evidence control\n')
    const file = join(root, 'evidence/m3/field/nested/note.md')
    writeFileSync(file, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', guard)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(file, 'utf8'), note, 'scan must retain exact source bytes')
    return { code: result.status, logs: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
for (const [title, note] of [
  ['EM DASH account email Markdown table', '| account\u2014email | invented-identity-a |'],
  ['HORIZONTAL BAR participant name marked header', '### **participant\u2015name**: invented-identity-b'],
  ['compatibility small em dash account ID list', '- account\ufe58id = invented-identity-c'],
  ['decimal EM DASH full name in quote', '> full&#8212;name: invented-identity-d'],
  ['hex HORIZONTAL BAR Dutch field in definition', '<dt>naam&#x2015;deelnemer</dt><dd>invented-identity-e</dd>'],
  ['named mdash participant email in HTML cell', '<th>participant&mdash;email</th><td>invented-identity-f</td>'],
  ['named horbar account ID quoted YAML', '  "account&horbar;id": invented-identity-g'],
  ['mixed raw and named dash in Dutch email address', '- e\u2014mail&horbar;adres: invented-identity-h'],
]) {
  test('QA #1737 independent EM DASH acceptance: ' + title, () => {
    const actual = probe(note)
    assert.equal(actual.code, 1, 'missed explicit fictional identity label: ' + title + '\n' + actual.logs)
    assert.match(actual.logs, /obvious participant identifier/)
  })
}
test('QA #1737 independent safe-control matrix has no grocery metadata false positives', () => {
  for (const note of [
    '| ingredient\u2014name | lentils |',
    '### **store\u2015name**: test shop',
    '- basket\ufe58id = synthetic-round',
    '> recipe&#8212;name: oats',
    '<dt>product&#x2015;label</dt><dd>example</dd>',
    '<th>region&mdash;code</th><td>fictional</td>',
    '  "basket&horbar;id": synthetic',
    'e\u2014mail&horbar;policy: not collecting addresses',
    'participantKey: pseudonymous-case-9',
    'Do not collect actual names, email addresses or customer IDs.',
  ]) {
    const actual = probe(note)
    assert.equal(actual.code, 0, 'benign grocery note rejected: ' + note + '\n' + actual.logs)
  }
})
