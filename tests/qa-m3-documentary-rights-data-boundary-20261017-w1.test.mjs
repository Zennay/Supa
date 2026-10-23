// Add-only independent adversarial-input QA for our M3 documentary
// operator audit. Untrusted in-process objects are not licence proofs and
// cannot execute JS before they are admitted as inert local JSON data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { auditM3DocumentaryRights } from '../scripts/qa-m3-documentary-rights-audit-20261017.mjs'

const refuses = /Independent M3 documentary rights audit refused/
async function canonical() {
  return JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
}

test('real canonical plain JSON remains a read-only denied M3 rights report', async () => {
  const input = await canonical()
  const previous = JSON.stringify(input)
  const output = auditM3DocumentaryRights(input)
  assert.equal(output.productionReady, false)
  assert.equal(output.releaseDecision, 'hold')
  assert.equal(output.unsafeDocumentaryUrls, 0)
  assert.equal(JSON.stringify(input), previous)
})

test('documentary audit rejects Proxy rights document before calling a user trap', async () => {
  let calls = 0
  const malicious = new Proxy(await canonical(), {
    get() { calls++; throw Error('UNTRUSTED_RIGHTS_PROXY_GETTER_MUST_NOT_RUN') },
    ownKeys() { calls++; throw Error('UNTRUSTED_RIGHTS_PROXY_KEYS_MUST_NOT_RUN') },
  })
  assert.throws(() => auditM3DocumentaryRights(malicious), refuses)
  assert.equal(calls, 0)
})

test('documentary audit rejects getter-bearing nested evidence before any value read', async () => {
  const input = await canonical()
  let calls = 0
  Object.defineProperty(input.sources[0].evidence[0], 'url', {
    enumerable: true,
    get() { calls++; throw Error('UNTRUSTED_EVIDENCE_URL_GETTER_MUST_NOT_RUN') },
  })
  assert.throws(() => auditM3DocumentaryRights(input), refuses)
  assert.equal(calls, 0)
})

test('documentary audit refuses custom object prototypes even if other properties are valid', async () => {
  const input = await canonical()
  Object.setPrototypeOf(input.sources[0], { inheritedLicense: true })
  assert.throws(() => auditM3DocumentaryRights(input), refuses)
})

test('documentary audit refuses hidden and symbolic fields in claimed source records', async () => {
  const hidden = await canonical()
  Object.defineProperty(hidden.sources[0], 'hiddenRights', {
    value: 'unverified', enumerable: false,
  })
  assert.throws(() => auditM3DocumentaryRights(hidden), refuses)
  const symbol = await canonical()
  symbol.sources[1][Symbol('internalGrant')] = true
  assert.throws(() => auditM3DocumentaryRights(symbol), refuses)
})

test('documentary audit refuses cyclic source metadata without executing recursion traps', async () => {
  const input = await canonical()
  input.sources[0].self = input
  assert.throws(() => auditM3DocumentaryRights(input), refuses)
})
