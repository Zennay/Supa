import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Postrepair interaction acceptance: nested Markdown + NFKC fullwidth metadata.
// Disposable synthetic notes only; no user or retailer data is read or written.
const scannerName = 'qa-m3-evidence-markdown-direct-identifier-boundary.test.mjs'
const scannerPath = fileURLToPath(new URL('./' + scannerName, import.meta.url))

function scanInDisposableRepository(note) {
  const root = mkdtempSync(join(tmpdir(), 'supa-m3-unicode-nesting-'))
  try {
    const testsDir = join(root, 'tests')
    const evidenceDir = join(root, 'evidence', 'm3')
    mkdirSync(testsDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    copyFileSync(scannerPath, join(testsDir, scannerName))
    writeFileSync(join(evidenceDir, 'README.md'), '# Synthetic M3 notes\n')
    writeFileSync(join(evidenceDir, 'nested.md'), note + '\n')
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', join(testsDir, scannerName)], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 20000,
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

const directIdentifiers = [
  ['fullwidth nested blockquotes', '＞ ＞ ｐａｒｔｉｃｉｐａｎｔＮａｍｅ： synthetic-name'],
  ['nested quoted fullwidth key', '> > ＂ｐａｒｔｉｃｉｐａｎｔ＿ｅｍａｉｌ＂：＂synthetic-value＂'],
  ['fullwidth marker followed by heading', '＞ ## **Ｆｕｌｌ　Ｎａｍｅ**: Synthetic Student'],
  ['list and quote with compatible hyphen', '- > ａｃｃｏｕｎｔ－ｉｄ = synthetic-account'],
  ['deep heading/list/quote', '### - ＞ ａｃｃｏｕｎｔＥｍａｉｌ: synthetic-value'],
]

for (const [description, markdown] of directIdentifiers) {
  test('QA M3 nested + NFKC privacy blocks ' + description, () => {
    const child = scanInDisposableRepository(markdown)
    assert.equal(child.status, 1,
      'direct identifier was not rejected:\n' + markdown + '\n' + child.stdout + child.stderr)
    assert.match(child.stdout + child.stderr, /obvious participant identifier/)
  })
}

test('QA M3 nested + NFKC privacy preserves pseudonyms and ordinary policy prose', () => {
  const benign = [
    '＞ ＞ ｐａｒｔｉｃｉｐａｎｔＫｅｙ： synthetic-pseudonym',
    '## ＞ ｓｔｕｄｙＩｄ： synthetic-week',
    '- > Product name: Broccoli',
    '### - ＞ Store name: DekaMarkt',
    '＞ ## Privacy policy\nNo names or email addresses may be stored.',
  ]
  for (const markdown of benign) {
    const child = scanInDisposableRepository(markdown)
    assert.equal(child.status, 0,
      'benign input rejected:\n' + markdown + '\n' + child.stdout + child.stderr)
  }
})
