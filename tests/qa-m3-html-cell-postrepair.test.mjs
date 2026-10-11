import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independently validate formatted HTML cells against the REAL M3 evidence guard.
// Do not use real study/participant data or modify committed evidence.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const originalScanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function run(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-html-postrepair-'))
  try {
    const dir = join(root, 'tests')
    const evidence = join(root, 'evidence', 'm3')
    mkdirSync(dir, { recursive: true })
    mkdirSync(evidence, { recursive: true })
    copyFileSync(originalScanner, join(dir, scannerName))
    writeFileSync(join(evidence, 'README.md'), '# Synthetic-only M3 evidence\n')
    writeFileSync(join(evidence, 'note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(dir, scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.match(child.stdout + child.stderr,
      /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const unsafe = [
  ['strong hyphenated participant name', '<tr><th><strong>participant-name</strong></th><td>Synthetic Student</td></tr>'],
  ['code email address alias', '<tr><td><code>email_address</code></td><td>synthetic-value</td></tr>'],
  ['Dutch bold participant name', '<tr><th><b>naam deelnemer</b></th><td>Synthetic Student</td></tr>'],
  ['existing plain header preserved', '<tr><td>participantEmail</td><td>synthetic-value</td></tr>'],
  ['compatible fullwidth strong tag', '<tr><td><ｓｔｒｏｎｇ>account-id</ｓｔｒｏｎｇ></td><td>synthetic-value</td></tr>'],
]
for (const [label, note] of unsafe) {
  test('QA M3 independent formatted HTML table refuses ' + label, () => {
    const child = run(note)
    assert.equal(child.status, 1,
      'synthetic direct identifier escaped:\n' + note + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 independent formatted HTML table retains benign pseudonyms and grocery content', () => {
  for (const note of [
    '<tr><td><strong>participantKey</strong></td><td>pseudonym-001</td></tr>',
    '<tr><th><code>studyId</code></th><td>synthetic-week</td></tr>',
    '<tr><td><b>Product name</b></td><td>Broccoli</td></tr>',
    '<tr><td><strong>Store name</strong></td><td>DekaMarkt</td></tr>',
    '<tr><th>Field</th><td>Meaning</td></tr>',
    '<p>Policy: direct personal names and contact data must not be stored.</p>',
  ]) {
    const child = run(note)
    assert.equal(child.status, 0,
      'benign note rejected:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
