import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const generatorScript = resolve('scripts/m3-create-observation-sheet.mjs')

test(
  'M3 observation generator creates on-disk field sheets owner-readable and owner-writable only',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-m3-private-sheet-'))
    const output = join(directory, 'observation-sheet.json')

    try {
      const result = spawnSync(
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

      assert.equal(result.status, 0, result.stderr)

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
