import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent black-box acceptance of the actual #1529 scanner. A fresh,
// synthetic repository is used for every case: no committed evidence is edited.
const SCANNER_NAME = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const SCANNER = fileURLToPath(new URL('./' + SCANNER_NAME, import.meta.url))

function runPrivacyGate(markdown) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'supa-m3-md-privacy-'))
  const testDir = join(tempRoot, 'tests')
  const evidenceDir = join(tempRoot, 'evidence', 'm3')
  try {
    mkdirSync(testDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(SCANNER, join(testDir, SCANNER_NAME))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic privacy test fixture\n')
    writeFileSync(join(evidenceDir, 'field-note.md'), markdown, 'utf8')
    const result = spawnSync(
      process.execPath,
      ['--test', join(testDir, SCANNER_NAME)],
      { encoding: 'utf8', timeout: 20000 },
    )
    assert.ifError(result.error)
    return result
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

const unsafeCases = [
  {
    name: 'fenced JSON double-quoted participant name',
    text: '```json\n{"participantName": "Synthetic Student"}\n```\n',
  },
  {
    name: 'fenced YAML single-quoted account ID',
    text: "```yaml\n'accountId': 'synthetic-123'\n```\n",
  },
  {
    name: 'quoted JSON-style Markdown list field',
    text: '- "participantEmail": "synthetic-person"\n',
  },
  {
    name: 'raw HTML table participant full-name field',
    text: '<table><tr><td>fullName</td><td>Synthetic Student</td></tr></table>\n',
  },
  {
    name: 'direct identifier hidden in HTML comment',
    text: '<!-- participantName: Synthetic Student -->\n',
  },
]

for (const { name, text } of unsafeCases) {
  test('QA M3 privacy gate rejects ' + name, () => {
    const result = runPrivacyGate(text)
    assert.equal(
      result.status,
      1,
      'Private identifier was accepted by the real Markdown repository scanner.\n' +
        'stdout:\n' + result.stdout + '\nstderr:\n' + result.stderr,
    )
    assert.match(result.stdout + result.stderr, /obvious participant identifier/)
  })
}

test('QA M3 privacy gate retains pseudonymous and policy-only Markdown controls', () => {
  for (const note of [
    '# Synthetic policy\nDo not commit participant names or email addresses.\n',
    '- participantKey: anonymous-001\n- studyId: synthetic-week-01\n',
    '| Field | Meaning |\n| participantKey | pseudonym |\n',
  ]) {
    const result = runPrivacyGate(note)
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr)
  }
})
