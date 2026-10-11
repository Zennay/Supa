import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent postrepair validation uses the actual Markdown evidence scanner
// in a disposable synthetic M3 repository. No participant or shop observations.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const original = fileURLToPath(new URL('./' + scanner, import.meta.url))
function runMarkdown(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-list-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(original, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic only\n')
    writeFileSync(join(root, 'evidence', 'm3', 'list.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
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

for (const [label, note] of [
  ['ordered task with inline-code direct identifier', '12. `participant_name`: synthetic-label'],
  ['ordered task with quoted account field', '> 21) "account-id": synthetic-label'],
  ['nested numbered unchecked task', '2. - [ ] participantEmail = synthetic-label'],
  ['ordered task Markdown table identifier', '3. | full name | synthetic label |'],
  ['task-list Markdown table identifier', '- [x] | participant-name | synthetic label |'],
  ['fullwidth numbered label', '３. ａｃｃｏｕｎｔ＿ｉｄ = synthetic-label'],
]) {
  test('QA M3 list privacy independent acceptance: ' + label, () => {
    const child = runMarkdown(note)
    assert.equal(child.status, 1,
      'fabricated direct identifier must fail real scanner:\n' + note + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 list privacy preserves nested legitimate grocery, policy and pseudonymous metadata', () => {
  for (const note of [
    '12. `participantKey`: student-pseudonymous-001',
    '> 21) Do not record a participant name in M3 evidence.',
    '2. - [ ] ingredient: Courgette',
    '3. | studyId | synthetic-study |',
    '- [x] | store name | PLUS |',
    '３. ｓｔｕｄｙＩｄ = synthetic-week',
  ]) {
    const child = runMarkdown(note)
    assert.equal(child.status, 0, 'legitimate note rejected:\n' + note + '\n' + child.stdout + child.stderr)
  }
})
