/** Independent QA-only inert JavaScript input boundary for exported GREEN proof. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { auditNativeGreenJob } from '../scripts/qa-native-green-ci-proof.mjs'

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const noProof = hostile => assert.throws(() => auditNativeGreenJob(hostile),
  /Unverified Supa native GREEN job evidence/)

test('hostile top-level getter must never execute before a generic refusal', () => {
  let called = 0
  const hostile = {expectedHead: HEAD, expectedBase: BASE}
  Object.defineProperty(hostile, 'run', {
    enumerable: true, get() {
      called++
      throw Error('EXECUTED_UNTRUSTED_TOP_LEVEL_GETTER')
    },
  })
  noProof(hostile)
  assert.equal(called, 0, 'do not invoke getters to inspect untrusted CI metadata')
})

test('top-level Proxy traps must never execute before a generic refusal', () => {
  let called = 0
  const hostile = new Proxy({}, {
    get() { called++; throw Error('EXECUTED_UNTRUSTED_TOP_LEVEL_PROXY') },
    getPrototypeOf() { called++; throw Error('EXECUTED_UNTRUSTED_PROXY_PROTO') },
    ownKeys() { called++; throw Error('EXECUTED_UNTRUSTED_PROXY_KEYS') },
  })
  noProof(hostile)
  assert.equal(called, 0)
})

test('nested run Proxy must not execute property getters', () => {
  let called = 0
  const hostile = {
    expectedHead: HEAD, expectedBase: BASE,
    job: {}, log: 'synthetic non-production log',
    run: new Proxy({}, {
      get() { called++; throw Error('EXECUTED_NESTED_RUN_PROXY') },
    }),
  }
  noProof(hostile)
  assert.equal(called, 0)
})

test('nested job getters cannot execute before validation of inert shape', () => {
  let called = 0
  const hostile = {expectedHead: HEAD, expectedBase: BASE, run: {}, log: ''}
  Object.defineProperty(hostile, 'job', {
    enumerable: true,
    get() { called++; throw Error('EXECUTED_UNTRUSTED_JOB_GETTER') },
  })
  noProof(hostile)
  assert.equal(called, 0)
})

test('nested steps array Proxy cannot execute length/index/method traps', () => {
  let called = 0
  const hostile = {expectedHead: HEAD, expectedBase: BASE, run: {},
    job: {steps: new Proxy([], {
      get() { called++; throw Error('EXECUTED_STEP_PROXY') },
    })}, log: ''}
  noProof(hostile)
  assert.equal(called, 0)
})

test('accessor descriptors and non-JSON classes are refused without invoking getter', () => {
  let touched = 0
  const input = {expectedHead: HEAD, expectedBase: BASE, run:{}, job:{}, log:''}
  Object.defineProperty(input.job, 'steps', {
    enumerable: true,
    get() { touched++; throw Error('EXECUTED_STEP_GETTER') },
  })
  noProof(input)
  assert.equal(touched, 0)
  const withDate = {expectedHead:HEAD,expectedBase:BASE,run:{},
    job:{steps: new Date()}, log:''}
  noProof(withDate)
})

test('cyclic/too-deep metadata must refuse atomically without a positive report', () => {
  const cycle = {expectedHead:HEAD,expectedBase:BASE,run:{},job:{},log:''}
  cycle.job.steps = cycle
  noProof(cycle)
  let deep = {}
  const outer = {expectedHead:HEAD,expectedBase:BASE,run:{},job:{},log:''}
  outer.job.extra = deep
  for(let i=0; i<40; i++) deep = deep.next = {}
  noProof(outer)
})
