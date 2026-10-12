import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeDerivedM3Output } from '../scripts/m3-source-output-preservation.mjs'

// Reproducible, synthetic fault injection rather than timing-sensitive SIGKILL
// or touching actual M3 field evidence. These #2039 tests are expected RED on
// the accidental-alias-only #2038 candidate.
async function fixture(action) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-atomic-'))
  const source = join(dir, 'input.json')
  const output = join(dir, 'report.json')
  const sourceBytes = '{"source":"SYNTHETIC_PRIVATE_NOT_OBSERVED"}\n'
  await writeFile(source, sourceBytes)
  try {
    await action({ source, output, sourceBytes })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('M3 interrupted existing-report write must preserve exact prior bytes [expected RED]', async () => {
  await fixture(async ({ source, output, sourceBytes }) => {
    const originalReport = '{"outcome":"unknown","publicSavingsClaimEligible":false}\n'
    await writeFile(output, originalReport)

    async function* interruptedDerivedReport() {
      yield '{"outcome":"UNCOMMITTED_PARTIAL"'
      throw new Error('SYNTHETIC_IO_INTERRUPTED')
    }

    await assert.rejects(
      () => writeDerivedM3Output(source, output, interruptedDerivedReport()),
      /SYNTHETIC_IO_INTERRUPTED/,
    )
    assert.equal(await readFile(source, 'utf8'), sourceBytes, 'input must remain unchanged on error')
    assert.equal(await readFile(output, 'utf8'), originalReport, 'a failed publish cannot replace the prior report with partial bytes')
    assert.equal((await stat(output)).isFile(), true)
  })
})

test('M3 interrupted creation must leave no partial output at a brand-new path [expected RED]', async () => {
  await fixture(async ({ source, output, sourceBytes }) => {
    async function* interruptedCreation() {
      yield '{"outcome":"PARTIAL_NOT_PUBLISHED"'
      throw new Error('SYNTHETIC_NEW_REPORT_INTERRUPTED')
    }

    await assert.rejects(
      () => writeDerivedM3Output(source, output, interruptedCreation()),
      /SYNTHETIC_NEW_REPORT_INTERRUPTED/,
    )
    assert.equal(await readFile(source, 'utf8'), sourceBytes)
    await assert.rejects(
      () => stat(output),
      { code: 'ENOENT' },
      'an interrupted new report cannot be visible even as a truncated or partial file',
    )
  })
})

test('M3 competing writers must publish one complete report, never mixed or partial bytes [expected RED]', async () => {
  await fixture(async ({ source, output, sourceBytes }) => {
    await writeFile(output, 'INITIAL_SYNTHETIC_REPORT\n')
    const completeA = 'A'.repeat(4096)
    const completeB = 'B'.repeat(4096)

    let pausedFirstWriter
    const firstWriterPaused = new Promise((resolve) => { pausedFirstWriter = resolve })
    let releaseFirstWriter
    const firstWriterGate = new Promise((resolve) => { releaseFirstWriter = resolve })

    async function* controlledFirstWriter() {
      // FileHandle.writeFile consumes the next generator item after flushing
      // the first chunk, giving a deterministic interleaving for the second.
      yield completeA.slice(0, 2048)
      pausedFirstWriter()
      await firstWriterGate
      yield completeA.slice(2048)
    }

    const pendingFirst = writeDerivedM3Output(source, output, controlledFirstWriter())
    try {
      await firstWriterPaused
      await writeDerivedM3Output(source, output, completeB)
    } finally {
      releaseFirstWriter()
      await pendingFirst
    }

    assert.equal(await readFile(source, 'utf8'), sourceBytes)
    const published = await readFile(output, 'utf8')
    assert.ok(
      published === completeA || published === completeB,
      'two concurrent writers may choose either complete result but must never publish a mixed report',
    )
  })
})

test('M3 repeated sequential distinct-output publication remains supported [positive control]', async () => {
  await fixture(async ({ source, output, sourceBytes }) => {
    const first = '{"outcome":"unknown","savingsCents":null,"publicSavingsClaimEligible":false}\n'
    const second = '{"outcome":"worse","savingsCents":-1,"publicSavingsClaimEligible":false}\n'
    await writeDerivedM3Output(source, output, first)
    assert.equal(await readFile(output, 'utf8'), first)
    await writeDerivedM3Output(source, output, second)
    assert.equal(await readFile(output, 'utf8'), second)
    assert.equal(await readFile(source, 'utf8'), sourceBytes)
  })
})
