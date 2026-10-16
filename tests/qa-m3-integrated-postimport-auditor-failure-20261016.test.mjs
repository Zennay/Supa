/**
 * Independent SUPA M3 QA, stacked on product #3259 exact
 * f5bae403dd3489b23e3ffe08b9a3abbbde48a853.
 * Simulate external Python auditor failure after real local historical SQLite
 * creation: no retailer requests, genuine customer data or release promotion.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/retailer-private-six-source-integrated-audit.mjs', import.meta.url))
const AUDIT = fileURLToPath(new URL('../scripts/retailer-audit-private-sqlite.py', import.meta.url))
const REFUSAL = 'Private SUPA M3 historical pipeline refused; no prices or savings published'

test('post-import audit failure withholds success but preserves a 0600 forensic SQLite for independent verification', () => {
  const work = mkdtempSync(join(tmpdir(), 'supa-qa-postimport-audit-failure-'))
  try {
    const detected = spawnSync('python3', ['-c', 'import sys;print(sys.executable)'], {
      encoding: 'utf8', timeout: 10_000,
    })
    assert.equal(detected.status, 0, 'the real Python interpreter must be available')
    const realPython = detected.stdout.trim()
    assert.ok(realPython.startsWith('/'), 'use an absolute interpreter before PATH injection')
    const bin = join(work, 'bin')
    mkdirSync(bin)
    const wrapperPath = join(bin, 'python3')
    const wrapper = '#!' + realPython + '\n' +
      'import os,sys\n' +
      "if len(sys.argv)>1 and sys.argv[1].endswith('retailer-audit-private-sqlite.py'):\n" +
      '    sys.exit(2)\n' +
      'os.execv(' + JSON.stringify(realPython) + ',[' + JSON.stringify(realPython) + ']+sys.argv[1:])\n'
    writeFileSync(wrapperPath, wrapper, { mode: 0o700, flag: 'wx' })
    chmodSync(wrapperPath, 0o700)
    const destination = join(work, 'fictional-private.sqlite')
    const denied = spawnSync(process.execPath,
      ['--experimental-strip-types', SCRIPT, '--out', destination], {
        encoding: 'utf8', timeout: 45_000, maxBuffer: 64 * 1024,
        env: { ...process.env, PATH: bin + delimiter + (process.env.PATH || '') },
      })
    assert.equal(denied.status, 2, denied.stderr)
    assert.equal(denied.stdout, '', 'failed audit must produce no report')
    assert.equal(denied.stderr, REFUSAL + '\n', 'fixed private diagnostics only')
    assert.equal(statSync(destination).mode & 0o777, 0o600)
    const before = readFileSync(destination)
    assert.ok(before.length > 100, 'the completed real SQLite must remain for forensics')
    const direct = spawnSync(realPython, [AUDIT, '--db', destination], {
      encoding: 'utf8', timeout: 15_000,
    })
    assert.equal(direct.status, 0, direct.stderr)
    const data = JSON.parse(direct.stdout)
    assert.equal(data.databaseIntegrityVerified, true)
    assert.equal(data.releaseDecision, 'hold')
    assert.equal(data.publicSavingsClaimEligible, false)
    assert.equal(data.sourceRightsVerified, false)
    assert.deepEqual(readFileSync(destination), before, 'read-only recheck must preserve bytes')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
