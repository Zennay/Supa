import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent QA acceptance, real staged scanner, fictional text only.
// In-memory canonicalization may never mutate a note on disk.
const scanner = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerSource = fileURLToPath(new URL('./' + scanner, import.meta.url))
const z = { sp: '\u200b', nj: '\u200c', j: '\u200d', w: '\u2060' }

function check(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-invisible-postrepair-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3'), { recursive: true })
    copyFileSync(scannerSource, join(root, 'tests', scanner))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Synthetic note QA\n')
    const notePath = join(root, 'evidence', 'm3', 'sample.md')
    writeFileSync(notePath, note, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scanner)], {
      cwd: root, env, encoding: 'utf8', timeout: 20000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    assert.equal(readFileSync(notePath, 'utf8'), note,
      'privacy scanning is read-only and must preserve Unicode bytes')
    return { code: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('QA #1528: postrepair Unicode format-char aliases of explicit fields and emails are rejected', () => {
  for (const note of [
    '- participant' + z.w + '_name: fake-learner',
    '**account' + z.j + '_email**: fake-address',
    '> full' + z.sp + ' name = fake-identity',
    '| participant' + z.nj + '-email | fake-label |',
    '<dt>account' + z.sp + '-id</dt><dd><b><span>fake-account</span></b></dd>',
    'synthetic@exam' + z.j + 'ple.test',
  ]) {
    const r = check(note)
    assert.equal(r.code, 1, 'Fictional direct identifier bypassed backstop:\n' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  }
})

test('QA #1528: pseudonym, grocery fields, empty values, Unicode policy prose stay benign and unchanged', () => {
  for (const note of [
    'participant' + z.sp + 'Key: anonymous-pseudonym',
    'study' + z.w + 'Id: synthetic-study',
    '<dt>participant_name</dt><dd><span><em></em></span></dd>',
    'ingredient' + z.j + '-name: Bloemkool',
    'store' + z.nj + '-name: PLUS',
    'Using zero-width characters in identifiers is not recommended.',
  ]) {
    const r = check(note)
    assert.equal(r.code, 0, 'Benign synthetic note rejected:\n' + JSON.stringify(note) + '\n' + r.output)
  }
})
