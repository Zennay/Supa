import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair black-box checks of the exact scanner; synthetic data only.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const source = fileURLToPath(new URL('./' + scanner, import.meta.url))
function run(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-html-attrs-qa-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(source, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fabricated testing only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'note.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    assert.match(child.stdout + child.stderr, /QA M3: every committed Markdown evidence note forbids obvious personal identifiers/)
    return child
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const rejected = [
  ['upper-case tag and two attributes', '<TR><TH><STRONG CLASS="privacy" ROLE="heading">FULL_NAME</STRONG></TH><TD>Synthetic Person</TD></TR>'],
  ['inline code language attribute', '<tr><td><code lang="en">email-address</code></td><td>synthetic-value</td></tr>'],
  ['attribute with punctuation and spacing', '<tr><td><b data-label="unit:k-g" id="field">naam-deelnemer</b></td><td>synthetic-value</td></tr>'],
  ['fullwidth field inside attributed tag', '<tr><td><strong class="header">ａｃｃｏｕｎｔ＿ｉｄ</strong></td><td>synthetic-value</td></tr>'],
]
for (const [label, note] of rejected) {
  test('QA M3 attributed-cell postrepair refuses ' + label, () => {
    const child = run(note)
    assert.equal(child.status, 1, 'synthetic identifier escaped:\n' + note + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 attributed-cell postrepair preserves non-identifying notes', () => {
  for (const note of [
    '<TR><TH><STRONG CLASS="privacy" ROLE="heading">participantKey</STRONG></TH><TD>pseudonym-99</TD></TR>',
    '<tr><td><code lang="en">studyId</code></td><td>example-week</td></tr>',
    '<tr><td><b data-label="unit:k-g" id="field">Ingredient name</b></td><td>Rice</td></tr>',
    '<tr><td><strong class="header">Store name</strong></td><td>DekaMarkt</td></tr>',
    '<p>Do not store participant name or account email as human identifiers.</p>',
  ]) {
    const child = run(note)
    assert.equal(child.status, 0, 'non-identifying example rejected:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
