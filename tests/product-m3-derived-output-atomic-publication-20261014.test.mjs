import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, link, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDerivedM3Output } from '../scripts/m3-source-output-preservation.mjs'

// Fictional local data only; never observed retailer prices.
async function sandbox(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-m3-atomic-'))
  const input = join(root, 'synthetic-input.json')
  const output = join(root, 'private-report.json')
  const inputBytes = '{"notRealRetailerEvidence":true}\n'
  await writeFile(input, inputBytes, { mode: 0o600 })
  try {
    await run({ root, input, output })
    assert.equal(await readFile(input, 'utf8'), inputBytes)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

test('M3 derived output replaces complete snapshots and resets permissive mode', () =>
  sandbox(async ({ input, output }) => {
    await writeFile(output, 'previous\n', { mode: 0o644 })
    await chmod(output, 0o644)
    const heldReader = await open(output, 'r')
    try {
      await writeDerivedM3Output(input, output, 'new-private-report\n')
      assert.equal(await readFile(output, 'utf8'), 'new-private-report\n')
      assert.equal(await heldReader.readFile('utf8'), 'previous\n')
      assert.equal((await stat(output)).mode & 0o777, 0o600)
      await writeDerivedM3Output(input, output, 'again\n')
      assert.equal(await readFile(output, 'utf8'), 'again\n')
    } finally {
      await heldReader.close()
    }
  }))

test('M3 interrupted writer preserves old output and cleans temporary file', () =>
  sandbox(async ({ root, input, output }) => {
    await writeFile(output, 'stable-old-report\n')
    async function* broken() {
      yield 'incomplete prefix'
      throw new Error('synthetic write interruption')
    }
    await assert.rejects(writeDerivedM3Output(input, output, broken()), /synthetic write interruption/)
    assert.equal(await readFile(output, 'utf8'), 'stable-old-report\n')
    assert.deepEqual((await readdir(root)).sort(), ['private-report.json', 'synthetic-input.json'])
  }))

test('M3 brand-new interrupted report is never visible at the final pathname', () =>
  sandbox(async ({ root, input, output }) => {
    async function* broken() {
      yield 'partial'
      throw new Error('synthetic incomplete new result')
    }
    await assert.rejects(writeDerivedM3Output(input, output, broken()), /synthetic incomplete new result/)
    await assert.rejects(stat(output), { code: 'ENOENT' })
    assert.deepEqual((await readdir(root)).sort(), ['synthetic-input.json'])
  }))

test('M3 reader sees complete prior report during staged serialization', () =>
  sandbox(async ({ input, output }) => {
    await writeFile(output, 'OLD_COMPLETE\n')
    let release
    let start
    const started = new Promise(resolve => { start = resolve })
    const gate = new Promise(resolve => { release = resolve })
    async function* incoming() {
      yield 'NEW_'
      start()
      await gate
      yield 'COMPLETE\n'
    }
    const pending = writeDerivedM3Output(input, output, incoming())
    try {
      await started
      assert.equal(await readFile(output, 'utf8'), 'OLD_COMPLETE\n')
    } finally {
      release()
      await pending
    }
    assert.equal(await readFile(output, 'utf8'), 'NEW_COMPLETE\n')
  }))

test('M3 unrelated hardlinks remain unchanged and source aliases are refused', () =>
  sandbox(async ({ root, input, output }) => {
    const unrelated = join(root, 'unrelated.json')
    await writeFile(unrelated, 'DO_NOT_TOUCH\n')
    await link(unrelated, output)
    await writeDerivedM3Output(input, output, 'valid-derived\n')
    assert.equal(await readFile(unrelated, 'utf8'), 'DO_NOT_TOUCH\n')
    assert.equal(await readFile(output, 'utf8'), 'valid-derived\n')
    await rm(output)
    await link(input, output)
    await assert.rejects(writeDerivedM3Output(input, output, 'forbidden\n'), /refusing to overwrite/)
    assert.equal(await readFile(output, 'utf8'), await readFile(input, 'utf8'))
  }))

test('M3 concurrent report writers publish one complete snapshot, never mixed bytes', () =>
  sandbox(async ({ input, output }) => {
    const a = 'A'.repeat(2048)
    const b = 'B'.repeat(2048)
    await writeFile(output, 'OLD_COMPLETE\\n')
    let started
    let release
    const firstChunkWritten = new Promise(resolve => { started = resolve })
    const resume = new Promise(resolve => { release = resolve })
    async function* firstWriter() {
      yield a.slice(0, 1024)
      started()
      await resume
      yield a.slice(1024)
    }
    const first = writeDerivedM3Output(input, output, firstWriter())
    try {
      await firstChunkWritten
      assert.equal(await readFile(output, 'utf8'), 'OLD_COMPLETE\\n')
      await writeDerivedM3Output(input, output, b)
      assert.equal(await readFile(output, 'utf8'), b)
    } finally {
      release()
      await first
    }
    assert.equal(await readFile(output, 'utf8'), a)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  }))

test('M3 final-path symlink never modifies an unrelated victim file', () =>
  sandbox(async ({ root, input, output }) => {
    const victim = join(root, 'private-victim.txt')
    await writeFile(victim, 'PRIVATE_ORIGINAL\n')
    await symlink(victim, output)
    await assert.rejects(writeDerivedM3Output(input, output, 'should-not-publish\n'), /symlinked/)
    assert.equal(await readFile(victim, 'utf8'), 'PRIVATE_ORIGINAL\n')
  }))
