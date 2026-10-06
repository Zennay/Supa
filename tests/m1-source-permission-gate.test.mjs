import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

const fixtureUrl = new URL(
  '../evidence/m1/source-permission-gate.v1.json',
  import.meta.url,
)

async function gate() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'))
}

test('current technical pair is valid but deliberately not production-ready', async () => {
  const result = evaluateSourcePermissionGate(await gate())

  assert.equal(result.productionReady, false)
  assert.deepEqual(
    result.blockers.map((item) => [
      item.supermarket,
      item.permissionStatus,
      item.productionEnabled,
    ]),
    [
      ['plus', 'permission_required', false],
      ['dekamarkt', 'unresolved', false],
    ],
  )
})

test('rejects impossible calendar dates in permission review metadata', async () => {
  for (const reviewedAt of ['2026-02-29', '2026-04-31', '2026-13-01']) {
    const document = await gate()
    document.reviewedAt = reviewedAt

    assert.throws(
      () => evaluateSourcePermissionGate(document),
      /requires a valid ISO review date/,
      reviewedAt,
    )
  }
})

test('cannot enable production while a source still requires permission', async () => {
  const document = await gate()
  document.sources.find((source) => source.supermarket === 'plus').productionEnabled = true

  assert.throws(
    () => evaluateSourcePermissionGate(document),
    /production ingestion must stay disabled while permission is permission_required/,
  )
})

test('rejects credential-bearing and non-default-port evidence URLs', async () => {
  for (const url of [
    'https://user@example.com/permission',
    'https://user:secret@example.com/permission',
    'https://example.com:8443/permission',
  ]) {
    const document = await gate()
    document.sources[0].evidence[0].url = url

    assert.throws(
      () => evaluateSourcePermissionGate(document),
      /evidence requires an HTTPS source URL/,
      url,
    )
  }
})

test('permitted status requires explicit authorization evidence', async () => {
  const document = await gate()
  const deka = document.sources.find((source) => source.supermarket === 'dekamarkt')
  deka.permissionStatus = 'permitted'

  assert.throws(
    () => evaluateSourcePermissionGate(document),
    /cannot be marked permitted without explicit authorization evidence/,
  )
})

test('explicit authorization can make the complete source pair production-ready', async () => {
  const document = await gate()

  for (const source of document.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({
      kind: 'written_permission',
      url: 'https://example.invalid/permission-record',
      finding: 'Test-only explicit authorization record.',
    })
  }

  const result = evaluateSourcePermissionGate(document)
  assert.equal(result.productionReady, true)
  assert.deepEqual(result.blockers, [])
})

test('the gate cannot silently drop one of the canonical technical sources', async () => {
  const document = await gate()
  document.sources = document.sources.filter(
    (source) => source.supermarket !== 'dekamarkt',
  )

  assert.throws(
    () => evaluateSourcePermissionGate(document),
    /permission gate must cover exactly: dekamarkt, plus/,
  )
})
