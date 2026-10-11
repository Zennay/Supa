import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent acceptance after the narrow fix on QA #1738.
// Distinct from the expected-RED cases: cover raw U+2061..U+2063
// and hex/decimal numeric references as well as named HTML entities.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scanner = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function runM3Scanner(markdown) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-math-entity-accept-'))
  try {
    mkdirSync(join(root, 'tests'))
    mkdirSync(join(root, 'evidence', 'm3', 'review', 'nested'), { recursive: true })
    copyFileSync(scanner, join(root, 'tests', scannerName))
    writeFileSync(join(root, 'evidence', 'm3', 'README.md'), '# Fictitious evidence boundary\n')
    const target = join(root, 'evidence', 'm3', 'review', 'nested', 'note.md')
    writeFileSync(target, markdown, 'utf8')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(root, 'tests', scannerName)], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.ifError(run.error)
    assert.notEqual(run.status, null, 'scanner stopped without process status')
    assert.equal(readFileSync(target, 'utf8'), markdown, 'source Markdown must stay byte-for-byte unmodified')
    return { status: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const [name, markdown] of [
  ['raw U+2061 participant email', 'participant\u2061email: fictional-alpha'],
  ['hex U+2062 full name', 'full&#x2062;name = imaginary-beta'],
  ['decimal U+2063 account id in table', '| account&#8291;id | dummy-gamma |'],
  ['hex U+2063 bold participant name', '**participant&#x2063;name**: placeholder-delta'],
  ['hex U+2061 HTML table participant email', '<th>participant&#x2061;email</th><td>fictional-epsilon</td>'],
  ['named InvisibleTimes HTML definition name', '<dt>full&InvisibleTimes;name</dt><dd>invented-zeta</dd>'],
  ['named InvisibleComma English address', 'E-mail&InvisibleComma;address: dummy-eta'],
  ['named InvisibleTimes quoted account email', '> "account&InvisibleTimes;email": fake-theta'],
]) {
  test('QA #1737 postrepair rejects independent math entity case: ' + name, () => {
    const result = runM3Scanner(markdown)
    assert.equal(result.status, 1, 'failed to reject obvious fictitious labelled identifier: ' + markdown + '\n' + result.output)
    assert.match(result.output, /obvious participant identifier/)
  })
}

test('QA #1737 postrepair preserves legitimate grocery and policy context', () => {
  for (const markdown of [
    'ingredient\u2061name: leek',
    'recipe&#x2062;name: tomato soup',
    '| store&#8291;id | demo-store |',
    '**shopping&InvisibleTimes;list**: tomatoes',
    '<dt>meal&InvisibleComma;name</dt><dd>rice bowl</dd>',
    'source&ApplyFunction;type: human-observed',
    'participantKey: pseudonym-only',
    'Policy prohibits participant names and email addresses in M3 notes.',
  ]) {
    const result = runM3Scanner(markdown)
    assert.equal(result.status, 0, 'benign grocery/policy context was rejected: ' + markdown + '\n' + result.output)
  }
})
