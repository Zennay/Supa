import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

const SCRIPT = resolve('scripts/m3-field-visit-card.mjs')
const DEMAND = buildObservationSheet().requirements
function runCard(args, cwd, timezone, lang) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types',
    SCRIPT, ...args,
  ], {
    cwd, encoding: 'utf8',
    env: { ...process.env, TZ: timezone, LANG: lang },
    timeout: 30_000,
  })
}

test('M3 independent QA: blank 11x2 field guidance stays byte-identical across locales/timezones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-field-portability-'))
  try {
    const variants = [
      ['Europe/Amsterdam', 'nl_NL.UTF-8'],
      ['America/New_York', 'en_US.UTF-8'],
      ['Asia/Tokyo', 'ja_JP.UTF-8'],
      ['UTC', 'C'],
    ]
    let expected = null
    for (const [zone, locale] of variants) {
      const processResult = runCard([], dir, zone, locale)
      assert.equal(processResult.status, 0, processResult.stderr)
      assert.equal(processResult.stderr, '')
      assert.ok(processResult.stdout.includes('GEEN bewijs'))
      assert.ok(processResult.stdout.includes('geen naam/e-mail'))
      if (expected === null) expected = processResult.stdout
      else assert.equal(processResult.stdout, expected, zone + ' ' + locale)
      assert.deepEqual(readdirSync(dir), [], 'text preview must not create an observation or receipt file')
    }
    const requiredRows = expected.split('\n').filter((line) => /^\d+\. /.test(line))
    assert.equal(requiredRows.length, 22)
    assert.deepEqual(requiredRows.slice(0, 11), requiredRows.slice(11))
    for (const requirement of DEMAND) {
      assert.ok(requiredRows.some((line) => line.includes(requirement.label)))
    }
    assert.doesNotMatch(expected, /EUR\s*0[.,]00|@example\./i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M3 independent QA: one-shop text exports keep identical planned demand with no other retailer headers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-single-card-'))
  try {
    const plus = runCard(['--store', 'plus'], dir, 'UTC', 'C')
    const deka = runCard(['--store', 'dekamarkt'], dir, 'UTC', 'C')
    for (const proc of [plus, deka]) {
      assert.equal(proc.status, 0, proc.stderr)
      assert.equal(proc.stderr, '')
    }
    assert.match(plus.stdout, /## PLUS/)
    assert.doesNotMatch(plus.stdout, /## DekaMarkt/)
    assert.match(deka.stdout, /## DekaMarkt/)
    assert.doesNotMatch(deka.stdout, /## PLUS/)
    const rows = (s) => s.split('\n').filter((line) => /^\d+\. /.test(line))
    assert.equal(rows(plus.stdout).length, 11)
    assert.deepEqual(rows(plus.stdout), rows(deka.stdout))
    assert.deepEqual(readdirSync(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M3 independent QA: unexpected output paths, flags and untrusted freeform fields fail without writes or echoed values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-card-reject-'))
  try {
    for (const args of [
      ['--output', 'private-should-not-exist.json'],
      ['--store', 'other-shop'],
      ['--store', '__proto__'],
      ['--store', 'plus', '--output', 'private-should-not-exist.json'],
      ['--participant', 'sensitive-fictional-marker'],
      ['--price', '1.00'],
      ['--store', '../../../etc/passwd'],
    ]) {
      const proc = runCard(args, dir, 'Europe/Amsterdam', 'nl_NL.UTF-8')
      assert.equal(proc.status, 1, args.join(' ') + '\n' + proc.stderr)
      assert.equal(proc.stdout, '')
      assert.ok(proc.stderr.includes('gebruik: node --experimental-strip-types'))
      assert.doesNotMatch(proc.stderr, /sensitive-fictional-marker|private-should-not-exist\.json|\.\.\/\.\.\//)
      assert.deepEqual(readdirSync(dir), [], 'no evidence/output file or hidden change on rejected input')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
