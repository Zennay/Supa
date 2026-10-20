// Independent QA of our own standalone documentary rights audit argv
// boundary. In-process invocations must not execute inherited code or invoke
// user-controlled getters before recognising the intended CLI mode.
import assert from 'node:assert/strict'
import test from 'node:test'
import { main } from '../scripts/qa-m3-documentary-rights-audit-20261017.mjs'

const refusal = /Independent M3 documentary rights audit refused/

test('documentary auditor refuses Proxy argv without invoking traps', async () => {
  let touched = 0
  const proxy = new Proxy(['--wrong'], {
    get() { touched++; throw Error('SECRET_PROXY_GET_MUST_NOT_RUN') },
    ownKeys() { touched++; throw Error('SECRET_PROXY_KEYS_MUST_NOT_RUN') },
    getOwnPropertyDescriptor() { touched++; throw Error('SECRET_PROXY_DESCRIPTOR_MUST_NOT_RUN') },
  })
  await assert.rejects(main(proxy, () => { throw Error('unexpected output') }), refusal)
  assert.equal(touched, 0, 'reject Proxy before any attacker trap')
})

test('documentary auditor rejects argv accessor without touching getter', async () => {
  let called = 0
  const argv = ['--wrong']
  Object.defineProperty(argv, '0', {
    get() { called++; return '--wrong' },
  })
  await assert.rejects(main(argv, () => { throw Error('unexpected output') }), refusal)
  assert.equal(called, 0, 'no accessor may execute on invalid argv')
})

test('documentary auditor requires native Array prototype and no inherited custom object', async () => {
  const argv = []
  Object.setPrototypeOf(argv, { inherited: true })
  await assert.rejects(main(argv, () => { throw Error('unexpected output') }), refusal)
})

test('documentary auditor rejects extra own keys and Symbol properties', async () => {
  const extra = []
  extra.debug = 'do-not-ignore'
  await assert.rejects(main(extra, () => { throw Error('unexpected output') }), refusal)
  const symbol = []
  symbol[Symbol('debug')] = 'do-not-ignore'
  await assert.rejects(main(symbol, () => { throw Error('unexpected output') }), refusal)
})

test('documentary auditor rejects sparse, nonarray and oversized argv without output', async () => {
  for (const argv of [new Array(1), {}, ['--wrong', '--wrong'], null]) {
    await assert.rejects(main(argv, () => { throw Error('unexpected output') }), refusal)
  }
})
