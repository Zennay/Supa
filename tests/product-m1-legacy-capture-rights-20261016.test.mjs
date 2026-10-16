import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../scripts/m1-capture-sources.mjs'
import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

test('legacy M1 workflow capture fails closed BEFORE any retailer HTTP or local artifacts under current canonical rights', async () => {
  const canonical = JSON.parse(await readFile(new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)))
  const rights = evaluateSourcePermissionGate(canonical)
  assert.equal(rights.productionReady, false)
  assert.deepEqual(rights.blockers.map(x => x.supermarket).sort(), ['dekamarkt', 'plus'])

  const parent = await mkdtemp(join(tmpdir(), 'supa-m1-rights-'))
  const unusedOutput = join(parent, 'capture-must-not-exist')
  const oldPath = process.env.SUPA_CAPTURE_DIR
  const oldFetch = globalThis.fetch
  let calls = 0
  process.env.SUPA_CAPTURE_DIR = unusedOutput
  globalThis.fetch = async () => {
    calls++
    throw new Error('NETWORK MUST NEVER OCCUR under denied rights')
  }
  try {
    await assert.rejects(() => main(), /M1 external capture denied/)
    assert.equal(calls, 0)
    await assert.rejects(() => access(unusedOutput), { code: 'ENOENT' })
  } finally {
    globalThis.fetch = oldFetch
    if (oldPath === undefined) delete process.env.SUPA_CAPTURE_DIR
    else process.env.SUPA_CAPTURE_DIR = oldPath
    await rm(parent, { recursive: true, force: true })
  }
})

test('canonical source rights cannot be passed with generic public terms disguised as a production grant', async () => {
  const canonical = JSON.parse(await readFile(new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)))
  for (const source of canonical.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
  }
  assert.throws(() => evaluateSourcePermissionGate(canonical),
    /cannot be marked permitted without explicit authorization evidence/)
})
