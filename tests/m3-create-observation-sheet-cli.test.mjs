import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const generatorScript = resolve('scripts/m3-create-observation-sheet.mjs')

test('M3 observation generator writes a valid nested output path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-generator-'))
  const output = join(directory, 'nested-output', 'observation-sheet.json')

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
    const sheet = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(sheet.sheetType, 'm3-manual-cart-observation-sheet')
    assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
    assert.equal(sheet.requirements.length, 11)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

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
        generatorScript,
        '--output',
        output,
      ],
      {
        cwd: directory,
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

test('M3 observation generator rejects an option-like output value before writing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-generator-'))
  const accidentalOutput = join(directory, '--force')

  try {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        generatorScript,
        '--output',
        '--force',
      ],
      {
        cwd: directory,
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /usage: m3:create-observation-sheet/)
    assert.equal(existsSync(accidentalOutput), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 observation generator rejects a blank output value before writing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-generator-'))
  const accidentalOutput = join(directory, '   ')

  try {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        generatorScript,
        '--output',
        '   ',
      ],
      {
        cwd: directory,
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /usage: m3:create-observation-sheet/)
    assert.equal(existsSync(accidentalOutput), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
