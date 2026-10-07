import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const generatorScript = resolve('scripts/m3-create-observation-sheet.mjs')

function runGenerator(directory, output) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      generatorScript,
      '--output',
      output,
    ],
    {
      cwd: directory,
      encoding: 'utf8',
    },
  )
}

test(
  'M3 observation generator creates all new field-run directories and sheets owner-only',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-m3-private-sheet-'))
    const fieldRunDirectory = join(directory, 'private-field-run')
    const outputDirectory = join(fieldRunDirectory, 'nested')
    const output = join(outputDirectory, 'observation-sheet.json')

    try {
      const result = runGenerator(directory, output)

      assert.equal(result.status, 0, result.stderr)

      for (const createdDirectory of [fieldRunDirectory, outputDirectory]) {
        const directoryStat = await stat(createdDirectory)
        assert.equal(
          directoryStat.mode & 0o777,
          0o700,
          `new M3 field-run directory must not be group/world accessible: ${createdDirectory}`,
        )
      }

      const fileStat = await stat(output)
      assert.equal(
        fileStat.mode & 0o777,
        0o600,
        'raw M3 field sheet must not be group/world readable or writable',
      )

      const sheet = JSON.parse(await readFile(output, 'utf8'))
      assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test(
  'M3 observation generator preserves existing directory permissions while securing new descendants',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-m3-existing-dir-'))
    const existingDirectory = join(directory, 'existing-field-run')
    const outputDirectory = join(existingDirectory, 'private-child')
    const output = join(outputDirectory, 'observation-sheet.json')

    try {
      await mkdir(existingDirectory)
      await chmod(existingDirectory, 0o750)

      const result = runGenerator(directory, output)

      assert.equal(result.status, 0, result.stderr)

      const existingDirectoryStat = await stat(existingDirectory)
      assert.equal(
        existingDirectoryStat.mode & 0o777,
        0o750,
        'generator must not chmod a directory that already exists',
      )

      const outputDirectoryStat = await stat(outputDirectory)
      assert.equal(
        outputDirectoryStat.mode & 0o777,
        0o700,
        'new descendant directories must still be owner-only',
      )

      const fileStat = await stat(output)
      assert.equal(fileStat.mode & 0o777, 0o600)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
