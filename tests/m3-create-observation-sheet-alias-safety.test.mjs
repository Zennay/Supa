import assert from 'node:assert/strict'
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
  'M3 observation generator refuses a symlink alias to an existing field sheet',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-m3-generator-alias-'))
    const genuine = join(directory, 'genuine-observation.json')
    const alias = join(directory, 'observation-sheet.json')
    const original = '{\n  "preserve": "genuine field input"\n}\n'

    try {
      await writeFile(genuine, original, 'utf8')
      await symlink(genuine, alias)

      const result = runGenerator(directory, alias)

      assert.notEqual(result.status, 0)
      assert.match(
        result.stderr,
        /refusing to overwrite existing observation sheet/,
      )
      assert.equal(await readFile(genuine, 'utf8'), original)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test('M3 observation generator refuses a hardlink alias to an existing field sheet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-generator-alias-'))
  const genuine = join(directory, 'genuine-observation.json')
  const alias = join(directory, 'observation-sheet.json')
  const original = '{\n  "preserve": "genuine field input"\n}\n'

  try {
    await writeFile(genuine, original, 'utf8')
    await link(genuine, alias)

    const result = runGenerator(directory, alias)

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /refusing to overwrite existing observation sheet/,
    )
    assert.equal(await readFile(genuine, 'utf8'), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
