import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const run = output => spawnSync(process.execPath,
  ['--experimental-strip-types', generator, '--output', output],
  { encoding: 'utf8', timeout: 15000 })
async function isolate(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-owner-output-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('product: multiple newly created nested private parent folders still work', async () => {
  await isolate(async root => {
    const output = join(root, 'alpha', 'beta', 'gamma', 'sheet.json')
    const runResult = run(output)
    assert.equal(runResult.status, 0, runResult.stderr)
    assert.equal(runResult.stdout, '')
    const body = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(body.evidenceStatus, 'collection-template-not-evidence')
    assert.equal(body.requirements.length, 11)
    assert.equal(body.baseline.lines.length, 11)
    assert.equal(body.candidate.lines.length, 11)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    for (const dir of [join(root, 'alpha'), join(root, 'alpha', 'beta'),
      join(root, 'alpha', 'beta', 'gamma')]) {
      assert.equal((await stat(dir)).mode & 0o777, 0o700)
    }
  })
})

test('product: private generator refuses non-directory output ancestor without mutating it', async () => {
  await isolate(async root => {
    const ancestor = join(root, 'untouched-file')
    const marker = 'FICTIONAL_RETAIN_BYTES\n'
    await writeFile(ancestor, marker, { mode: 0o600 })
    const result = run(join(ancestor, 'sheet.json'))
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr.includes(root), false)
    assert.equal(await readFile(ancestor, 'utf8'), marker)
  })
})

test('product: own output no-clobber remains enforced after parent validation', async () => {
  await isolate(async root => {
    const output = join(root, 'nested', 'sheet.json')
    assert.equal(run(output).status, 0)
    const original = await readFile(output, 'utf8')
    const second = run(output)
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /refusing to overwrite existing observation sheet/)
    assert.equal(await readFile(output, 'utf8'), original)
  })
})

test('product: symlinked first parent refuses without creating redirected file', { skip: process.platform === 'win32' }, async () => {
  await isolate(async root => {
    const real = join(root, 'real')
    await mkdir(real, { mode: 0o700 })
    const alias = join(root, 'FICTIONAL_SECRET_OUTPUT_ALIAS')
    await symlink(real, alias, 'dir')
    const result = run(join(alias, 'new', 'sheet.json'))
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr.includes('FICTIONAL_SECRET_OUTPUT_ALIAS'), false)
    await assert.rejects(stat(join(real, 'new', 'sheet.json')), { code: 'ENOENT' })
  })
})
