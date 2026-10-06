import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('M3 observation generator refuses to overwrite an existing field sheet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-generator-'))
  const output = join(directory, 'observation-sheet.json')
  const original = '{\n  "preserve": "genuine field input"\n}\n'

  try {
    await writeFile(output, original, 'utf8')

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-create-observation-sheet.mjs',
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /refusing to overwrite existing observation sheet/,
    )
    assert.equal(await readFile(output, 'utf8'), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
