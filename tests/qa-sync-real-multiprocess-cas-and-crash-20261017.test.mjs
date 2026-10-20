import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFileSyncStore } from '../server/sync-store.mjs'

// Independent QA: real child OS processes, not only multiple objects in the
// same JS event loop. Synthetic bearer and plans, local tmpdir, zero HTTP.
// Must never exercise, alter or claim live Supa retailer/customer evidence.
const KEY = 'C'.repeat(43)
const ENTRY = 'supa:planner-preferences:v2'
const moduleRoot = new URL('../', import.meta.url).pathname

const writerScript = String.raw`
import { createFileSyncStore } from './server/sync-store.mjs'
const [dir, key, rev, budget] = process.argv.slice(1)
process.stdout.write('READY\n')
for await (const chunk of process.stdin) {
  if (chunk.toString().includes('GO')) break
}
try {
  const entries = { 'supa:planner-preferences:v2': JSON.stringify({ budget: Number(budget), activeDays: ['Ma'], recipeByDay: {} }) }
  const answer = await createFileSyncStore({ dir }).write(key, Number(rev), entries)
  process.stdout.write('RESULT ' + JSON.stringify(answer) + '\n')
} catch (error) {
  process.stderr.write('WRITE_FAILED ' + String(error?.code || error?.message) + '\n')
  process.exitCode = 1
}
`;

const crashScript = String.raw`
import { mkdir, open } from 'node:fs/promises'
const [dir, lock] = process.argv.slice(1)
await mkdir(dir, { recursive: true, mode: 0o700 })
await open(lock, 'wx', 0o600)
process.stdout.write('LOCKED\n')
await new Promise(() => {})
`;

function child(code, args, t) {
  const proc = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], {
    cwd: moduleRoot, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let wake
  let ready
  const readyPromise = new Promise((resolve, reject) => { ready = resolve; wake = reject })
  const exitPromise = new Promise(resolve => {
    proc.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const timeout = setTimeout(() => {
    proc.kill('SIGKILL')
    wake(new Error('subprocess never reached READY/LOCKED'))
  }, 12_000)
  t.after(() => { clearTimeout(timeout); if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL') })
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  proc.stdout.on('data', chunk => {
    stdout += chunk
    if (stdout.includes('READY\n') || stdout.includes('LOCKED\n')) {
      clearTimeout(timeout)
      ready()
    }
  })
  proc.stderr.on('data', chunk => { stderr += chunk })
  proc.once('error', wake)
  return {
    proc, ready: readyPromise,
    async finish() {
      const end = await exitPromise
      return { ...end, stdout, stderr }
    },
  }
}

async function tmp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-sync-multiprocess-qa-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

for (const [label, revision] of [['first-ever', 0], ['updated', 1]]) {
  test('cross-OS-process CAS: only one of eight '+label+' writers with same revision may succeed', async t => {
    const root = await tmp(t)
    const dir = join(root, 'sync')
    const store = createFileSyncStore({ dir })
    if (revision === 1) {
      const initial = await store.write(KEY, 0, { [ENTRY]: '{"seed":true}' })
      assert.equal(initial.conflict, false)
    }
    const processes = Array.from({ length: 8 }, (_, i) => child(writerScript, [dir, KEY, String(revision), String(30 + i)], t))
    await Promise.all(processes.map(p => p.ready))
    for (const p of processes) p.proc.stdin.end('GO\n')
    const results = await Promise.all(processes.map(p => p.finish()))
    assert.ok(results.every(r => r.code === 0), 'every process must exit without ENOENT/500-equivalent: '+JSON.stringify(results.filter(r=>r.code!==0)))
    const records = results.map(r => {
      const match = /^RESULT (\{.*\})$/m.exec(r.stdout)
      assert.ok(match, 'each process must return an actual CAS outcome')
      return JSON.parse(match[1])
    })
    const winners = records.filter(r => r.conflict === false)
    const losers = records.filter(r => r.conflict === true)
    assert.equal(winners.length, 1, 'global revision CAS must be unique across OS PIDs')
    assert.equal(losers.length, 7, 'other physical writer processes must receive conflict')
    assert.ok(losers.every(r=>r.record.revision === revision+1), 'losers observe the actual winning revision')
    const persisted = await store.read(KEY)
    assert.equal(persisted.revision, revision + 1)
    assert.deepEqual(persisted.entries, winners[0].record.entries, 'one acknowledged winner must equal persisted bytes')
    const files = await readdir(dir)
    assert.equal(files.length, 1, 'no orphan lock or tmp after all competing processes finish')
    assert.match(files[0], /^[a-f0-9]{64}\.json$/)
  })
}

test('crashed physical lock-holder is recoverable without losing current revision or leaving a poisoned lock', async t => {
  const root = await tmp(t)
  const dir = join(root, 'sync')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const lock = join(dir, createHash('sha256').update(KEY).digest('hex') + '.lock')
  const crashed = child(crashScript, [dir, lock], t)
  await crashed.ready
  assert.deepEqual(await readdir(dir), [lock.split('/').pop()])
  crashed.proc.kill('SIGKILL')
  const exit = await crashed.finish()
  assert.equal(exit.signal, 'SIGKILL', 'holder must actually exit before recovery starts')
  const expired = new Date(Date.now() - 60_000)
  await utimes(lock, expired, expired)

  const store = createFileSyncStore({ dir })
  const result = await store.write(KEY, 0, { [ENTRY]: '{"after":"crash"}' })
  assert.equal(result.conflict, false)
  assert.equal(result.record.revision, 1)
  assert.equal((await store.read(KEY)).entries[ENTRY], '{"after":"crash"}')
  const files = await readdir(dir)
  assert.equal(files.length, 1, 'stale crashed lock and temp files must be removed')
  assert.ok(files[0].endsWith('.json'))
  assert.equal((await readFile(join(dir, files[0]), 'utf8')).includes(KEY), false, 'never write bearer secret')
})
