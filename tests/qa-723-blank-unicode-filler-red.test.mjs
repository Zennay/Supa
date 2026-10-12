import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #723: synthetic expected-RED for blank Unicode graphic fillers in Git
// filenames. Use an alternate ephemeral GIT_INDEX_FILE and only the public
// .gitignore blob hash. Never read private captures, secrets or evidence.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const publicBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function checkIndex(paths) {
  const temp = mkdtempSync(join(tmpdir(), 'supa-qa-blank-path-red-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'index') }
    const seeded = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seeded.status, 0, seeded.stderr?.toString())

    for (const path of paths) {
      const bytes = Buffer.concat([
        Buffer.from('100644 ' + publicBlob + ' 0\t'),
        Buffer.from(path, 'utf8'), Buffer.from([0]),
      ])
      const added = spawnSync('git', ['update-index', '-z', '--index-info'], {
        cwd: root, env, input: bytes,
      })
      assert.equal(added.status, 0, added.stderr?.toString())
      const index = execFileSync('git', ['ls-files', '-z'], { cwd: root, env })
      assert.ok(index.includes(Buffer.concat([Buffer.from(path, 'utf8'), Buffer.from([0])])))
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(run.error)
    return { accepted: run.status === 0, output: (run.stdout || '') + (run.stderr || '') }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

for (const [label, name] of [
  ['U+3164 HANGUL FILLER hidden after env basename', 'src/.env\u3164'],
  ['U+FFA0 HALFWIDTH HANGUL FILLER inside folder name', 'docs/report\uFFA0final.md'],
  ['U+115F HANGUL CHOSEONG FILLER inside source name', 'src/list\u115Fview.ts'],
  ['U+1160 HANGUL JUNGSEONG FILLER at start of component', 'docs/\u1160budget.md'],
  ['U+2800 BRAILLE PATTERN BLANK inside README', 'docs/read\u2800me.md'],
]) {
  test('QA #723 expected RED: tracked blank Unicode glyph forbidden: ' + label, () => {
    const result = checkIndex([name])
    assert.equal(result.accepted, false,
      'review-confusing blank glyph unexpectedly passed Git path guard\n' + result.output)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #723 blank-glyph guard must keep real multilingual and combining filenames', () => {
  const result = checkIndex([
    '.env.example',
    'docs/한국어-식단.md',
    'docs/점심-메뉴.md',
    'docs/cafe\u0301.md',
    'docs/⠁⠃⠉-braille-label.md',
    'docs/پیش\u200cغذا.md',
    'docs/👩‍🍳-week.md',
    'src/domain/basket.ts',
  ])
  assert.equal(result.accepted, true, 'legitimate tracked names rejected\n' + result.output)
})
