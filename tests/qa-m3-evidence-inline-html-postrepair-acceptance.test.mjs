import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Fresh, independent #1528 postrepair acceptance. Only fictional information.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))
function scan(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-inline-html-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictional tests only\n')
    const file = join(root, 'evidence', 'm3', 'nested', 'observation.md')
    writeFileSync(file, note)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null, 'privacy guard must actually finish')
    assert.equal(readFileSync(file, 'utf8'), note, 'evidence bytes must stay identical')
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const identityCases = [
  '- <i>account_email</i>: invented-recipient',
  '> <b>participant-name</b> = imaginary-student',
  '| <code>full name</code> | imaginary-person |',
  '- <span class="privacy-id">participant</span><strong>_name</strong>: imaginary-person',
  '<p><em>naam deelnemer</em>: fictional-person</p>',
  '[<strong>account-id</strong>](https://example.invalid/help): invented-id',
  '- **<span>participant_email</span>**: invented-recipient',
  'Contact: invented@<em>example</em>.test',
]
for (const [index, note] of identityCases.entries()) {
  test('QA #1528: independent inline HTML/privacy regression ' + (index + 1), () => {
    const r = scan(note)
    assert.equal(r.status, 1, 'visible identity evaded scan: ' + JSON.stringify(note) + '\n' + r.output)
    assert.match(r.output, /obvious participant identifier/)
  })
}

const benignCases = [
  '- <span>store name</span>: PLUS',
  '- <strong>ingredient name</strong>: pasta',
  '<p><b>Privacy rule</b>: never collect participant names.</p>',
  '- <code>participant_name</code> is a prohibited field.',
  '<span aria-label="account-id: fictitious">Privacy policy</span>',
  '- <span>unit</span>: kg',
  'studyId: fictitious-week-01',
  '| <code>ingredient name</code> | broccoli |',
]
for (const [index, note] of benignCases.entries()) {
  test('QA #1528: independent inline HTML benign metadata ' + (index + 1), () => {
    const r = scan(note)
    assert.equal(r.status, 0, 'benign content rejected: ' + JSON.stringify(note) + '\n' + r.output)
  })
}
