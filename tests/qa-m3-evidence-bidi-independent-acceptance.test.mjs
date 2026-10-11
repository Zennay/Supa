import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent QA #1737 postrepair cases, distinct from #1749 RED data.
// All references, identities, groceries and Markdown files are synthetic.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function checkSynthetic(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-bidi-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence/m3/qa/branch'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence/m3/README.md'), '# Invented fixture\n')
    const note = join(root, 'evidence/m3/qa/branch/note.md')
    writeFileSync(note, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(note, 'utf8'), markdown, 'scanner must preserve original bytes')
    return { exit: result.status, logs: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [label, note] of [
  ['raw PDF U+202C in HTML cell', '<th>participant\u202Cname</th><td>invented-a</td>'],
  ['raw LRO U+202D in heading', '## account\u202Did = fictional-b'],
  ['hex numeric RLO U+202E in quote', '> full&#x202e;name: fake-c'],
  ['decimal numeric LRE U+202A in list', '- participant&#8234;email: sample-d'],
  ['decimal numeric RLE U+202B in definition', '<dt>account&#8235;email</dt><dd>madeup-e</dd>'],
  ['mixed invisible embedding controls in bold', '**participant\u202A\u202Dname** = imaginary-f'],
  ['embedded RLO inside a fake contact email', 'alice\u202E@example.test'],
]) {
  test('QA #1737 independent bidi acceptance: ' + label, () => {
    const check = checkSynthetic(note)
    assert.equal(check.exit, 1, 'missed fictional identity: ' + label + '\n' + check.logs)
    assert.match(check.logs, /obvious participant identifier/)
  })
}

test('QA #1737 independent benign controls preserve grocery metadata and privacy policy', () => {
  for (const note of [
    'item\u202Cname: broccoli',
    'basket\u202Did: week-1',
    '> recipe&#x202e;title: pasta',
    '- product&#8234;unit: kg',
    '<dt>store&#8235;scope</dt><dd>fixture</dd>',
    '**ingredient\u202A\u202Dname** = rice',
    'participantKey: pseudonymous-case-123',
    'Policy only: avoid names and email addresses in the evidence directory.',
  ]) {
    const check = checkSynthetic(note)
    assert.equal(check.exit, 0, 'safe synthetic metadata blocked: ' + note + '\n' + check.logs)
  }
})
