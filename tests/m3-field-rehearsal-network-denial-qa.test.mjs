import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/m3-rehearse-field-run.mjs', import.meta.url))
const guard = `import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'
const blocked = () => { throw new Error('QA_NETWORK_DENIED') }
globalThis.fetch = blocked
for (const module of [http, https]) {
  module.get = blocked
  module.request = blocked
}
net.connect = blocked
net.createConnection = blocked
tls.connect = blocked
dns.lookup = blocked
dns.resolve = blocked
syncBuiltinESMExports()
`

test('network-denial hook is active before checking the independent rehearsal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-network-denial-'))
  try {
    const preload = join(dir, 'deny-network.mjs')
    writeFileSync(preload, guard, { mode: 0o600 })
    const preloadUrl = pathToFileURL(preload).href
    // The positive control proves the hook would actually reject a fetch.
    const selfTest = spawnSync(process.execPath, [
      '--import', preloadUrl,
      '--input-type=module', '-e',
      "await fetch('https://definitely-not-called.invalid')",
    ], { cwd: dir, encoding: 'utf8', timeout: 20000 })
    assert.notEqual(selfTest.status, 0)
    assert.match(selfTest.stderr, /QA_NETWORK_DENIED/)
    assert.equal(selfTest.stdout, '')

    // In a separately preloaded process the exact production CLI must run to
    // completion without any direct fetch, HTTP(S), TCP, TLS or DNS request.
    const run = spawnSync(process.execPath, [
      '--experimental-strip-types', '--import', preloadUrl, script,
    ], { cwd: dir, encoding: 'utf8', timeout: 30000 })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stderr, '')
    const result = JSON.parse(run.stdout)
    assert.equal(result.syntheticOnly, true)
    assert.equal(result.converterAndAssessorOperational, true)
    assert.equal(result.realRetailerEvidenceVerified, false)
    assert.equal(result.m3ExitProven, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.m4BetaEligible, false)
    assert.equal(readFileSync(preload, 'utf8'), guard)
    assert.deepEqual(readdirSync(dir), ['deny-network.mjs'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
