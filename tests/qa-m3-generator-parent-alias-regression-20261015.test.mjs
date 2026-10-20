import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Independent QA only: no retailer HTTP, price, person or real M3 field evidence.
// These tests exercise the actual CLI process with private temporary files.
// A last-component O_EXCL ('wx') guard does not constrain symlinked *parents*.
const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const SECRET = 'FICTIONAL_M3_QA_PRIVATE_PATH_NOT_A_PERSON'
const unix = { skip: process.platform === 'win32' }

async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-generator-parent-qa-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}

function generate(destination) {
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', generator, '--output', destination],
    { encoding: 'utf8', timeout: 15000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.stdout, '', 'private sheet must not be written to terminal')
  assert.equal((result.stdout + result.stderr).includes(SECRET), false,
    'private path must not appear in process output')
  return result
}

test('positive: a real nested output directory creates exactly one private canonical sheet', async () => {
  await sandbox(async root => {
    const output = join(root, 'real', 'nested', 'observation.json')
    const result = generate(output)
    assert.equal(result.status, 0, result.stderr)
    const sheet = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    assert.equal(sheet.baseline.lines.length, 11)
    assert.equal(sheet.candidate.lines.length, 11)
    assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  })
})

test('positive: an existing sheet cannot be overwritten through a leaf symlink', unix, async () => {
  await sandbox(async root => {
    const originalPath = join(root, 'original.json')
    const original = 'FICTIONAL_ORIGINAL_SHEET_PRESERVE_EXACT_BYTES\n'
    await writeFile(originalPath, original, { mode: 0o600 })
    const alias = join(root, 'leaf-alias.json')
    await symlink(originalPath, alias)
    const result = generate(alias)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to overwrite existing observation sheet/u)
    assert.equal(await readFile(originalPath, 'utf8'), original)
  })
})

for (const scenario of ['direct-parent', 'nested-ancestor']) {
  test(`expected RED: generator refuses ${scenario} symlink to private output directory`, unix, async () => {
    await sandbox(async root => {
      const privateDir = join(root, 'private', 'real')
      await mkdir(join(privateDir, 'nested'), { recursive: true, mode: 0o700 })
      const protectedFile = join(privateDir, 'preserve.txt')
      const protectedBytes = 'FICTIONAL_PRIVATE_PREEXISTING_CONTENT\n'
      await writeFile(protectedFile, protectedBytes, { mode: 0o600 })
      const alias = join(root, SECRET + '-' + scenario)
      await symlink(privateDir, alias, 'dir')
      const output = scenario === 'direct-parent'
        ? join(alias, 'new-observation.json')
        : join(alias, 'nested', 'new-observation.json')
      const actualOutput = scenario === 'direct-parent'
        ? join(privateDir, 'new-observation.json')
        : join(privateDir, 'nested', 'new-observation.json')
      const result = generate(output)
      assert.notEqual(result.status, 0,
        'symlinked parent must not be admitted as new private output location')
      await assert.rejects(readFile(actualOutput, 'utf8'), { code: 'ENOENT' },
        'refused output must not be published under a redirected parent')
      assert.equal(await readFile(protectedFile, 'utf8'), protectedBytes)
    })
  })
}
