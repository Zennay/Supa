import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { writeNewPrivateM3Artifact } from '../scripts/m3-private-derived-output.mjs'

async function withScratch(label, use) {
  const root = await mkdtemp(join(tmpdir(), `supa-${label}-`))
  try {
    await use(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('QA M3 private derived path refuses symlink several directory levels above output', {
  skip: process.platform === 'win32',
}, async () => {
  await withScratch('nested-dir-symlink', async (root) => {
    const intended = join(root, 'normal', 'alias', 'new', 'derived.json')
    const actual = join(root, 'redirected')
    const alias = join(root, 'normal', 'alias')
    await mkdir(join(root, 'normal'))
    await mkdir(actual)
    await symlink(actual, alias, 'dir')
    await assert.rejects(
      writeNewPrivateM3Artifact(intended, '{"synthetic":true}\n', 'existing'),
      /M3 output parent must be a real directory/,
    )
    assert.equal((await lstat(alias)).isSymbolicLink(), true)
    await assert.rejects(stat(join(actual, 'new')), { code: 'ENOENT' })
  })
})

test('QA M3 private derived path refuses regular file used as a directory', async () => {
  await withScratch('nondir', async (root) => {
    const blocker = join(root, 'existing-regular-file')
    await writeFile(blocker, 'untouched source')
    await assert.rejects(
      writeNewPrivateM3Artifact(join(blocker, 'derived.json'), '{"synthetic":true}\n', 'existing'),
      /M3 output parent must be a real directory/,
    )
    assert.equal(await readFile(blocker, 'utf8'), 'untouched source')
  })
})

test('QA M3 private derived path preserves existing directory and file while making new nested output private', {
  skip: process.platform === 'win32',
}, async () => {
  await withScratch('private-parent-contract', async (root) => {
    const existing = join(root, 'shared-existing')
    await mkdir(existing)
    await chmod(existing, 0o755)
    const newParent = join(existing, 'new-private', 'nested')
    const output = join(newParent, 'derived.json')
    await writeNewPrivateM3Artifact(output, '{"synthetic":true}\n', 'artifact already exists')

    assert.equal((await stat(existing)).mode & 0o777, 0o755)
    assert.equal((await stat(join(existing, 'new-private'))).mode & 0o777, 0o700)
    assert.equal((await stat(newParent)).mode & 0o777, 0o700)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(await readFile(output, 'utf8'), '{"synthetic":true}\n')

    await assert.rejects(
      writeNewPrivateM3Artifact(output, '{"synthetic":"replacement"}\n', 'artifact already exists'),
      /artifact already exists/,
    )
    assert.equal(await readFile(output, 'utf8'), '{"synthetic":true}\n')
  })
})
