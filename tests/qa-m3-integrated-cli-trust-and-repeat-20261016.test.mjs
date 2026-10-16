/**
 * Independent SUPA quality-validation on immutable product integration
 * #3259 / f5bae403dd3489b23e3ffe08b9a3abbbde48a853.
 *
 * Exercises exported integrated CLI trust and the physical repeat-run contract.
 * Uses only synthetic private temp paths and already-reviewed repository
 * fixtures: no live retailer calls, customer data or public savings claims.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, buildAndAuditHistoricalRetailerDatabase } from
  '../scripts/retailer-private-six-source-integrated-audit.mjs'

const DOMAIN = 'Private SUPA M3 historical pipeline refused; no prices or savings published'

async function scoped(callback) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-integrated-boundary-'))
  try { await callback(root, join(root, 'fictional-private.sqlite')) }
  finally { await rm(root, { recursive: true, force: true }) }
}
async function refused(action) {
  await assert.rejects(action, error =>
    error instanceof Error && error.message === DOMAIN &&
    !/TypeError|ERR_INVALID_ARG|fictional-private\.sqlite/.test(error.message))
}

test('exported integrated main refuses hostile argv shapes without caller traps, callback or disk writes', async () => {
  await scoped(async (directory, destination) => {
    let getterCalls = 0
    let proxyCalls = 0
    let published = 0
    const accessor = ['--out', destination]
    Object.defineProperty(accessor, '1', {
      configurable: true, enumerable: true,
      get() { getterCalls++; throw Error('FICTIONAL_PRIVATE_GETTER') },
    })
    const proxy = new Proxy(['--out', destination], {
      get() { proxyCalls++; throw Error('FICTIONAL_PRIVATE_PROXY') },
      ownKeys() { proxyCalls++; throw Error('FICTIONAL_PRIVATE_PROXY') },
    })
    const sparse = new Array(2)
    sparse[0] = '--out'
    const withExtra = ['--out', destination]
    Object.defineProperty(withExtra, 'hidden', { value: 'fictional private', enumerable: true })
    const cases = [
      null, undefined, {}, Object.create(null),
      accessor, proxy, sparse, withExtra,
      ['--out', new String(destination)],
      ['--out', destination, '--live'],
      ['--out', 'x'.repeat(4097)],
    ]
    for (const candidate of cases) {
      await refused(() => main(candidate, () => { published++ }))
      assert.deepEqual(await readdir(directory), [], 'rejected argv must not create files')
    }
    assert.equal(getterCalls, 0, 'must reject accessor before executing user code')
    assert.equal(proxyCalls, 0, 'must reject Proxy before running traps')
    assert.equal(published, 0, 'rejected input must never call writer')
  })
})

test('exported integrated builder rejects malformed physical destination with domain-only error', async () => {
  await scoped(async (directory, destination) => {
    for (const path of [destination + '\0private', destination + '\nsecret', '', '-not-a-path']) {
      await refused(() => buildAndAuditHistoricalRetailerDatabase(path))
      assert.deepEqual(await readdir(directory), [])
    }
  })
})

test('integrated pipeline rejects a symlinked parent before touching its real private target', async () => {
  await scoped(async (directory, destination) => {
    const alias = join(directory, 'symlinked-parent')
    await symlink(directory, alias, 'dir')
    const before = await readdir(directory)
    await refused(() => main(['--out', join(alias, 'fictional-private.sqlite')]))
    assert.deepEqual(await readdir(directory), before)
    await assert.rejects(() => lstat(destination), { code: 'ENOENT' })
  })
})

test('successful direct integrated main publishes one HOLD and a second run refuses to overwrite exact SQLite bytes', async () => {
  await scoped(async (directory, destination) => {
    const messages = []
    const first = await main(['--out', destination], message => { messages.push(message) })
    assert.equal(messages.length, 1)
    assert.deepEqual(JSON.parse(messages[0]), first)
    assert.equal(first.releaseDecision, 'hold')
    assert.equal(first.physicalDatabaseIntegrityVerified, true)
    assert.equal(first.canonicalPlannerNeeds, 11)
    assert.equal(first.twoStoreReviewRows, 22)
    assert.equal(first.publicSavingsClaimEligible, false)
    assert.equal(first.sourceRightsVerified, false)
    assert.equal(first.actualRetailerPricesVerified, false)
    assert.equal(first.externalRequests, 0)
    assert.doesNotMatch(messages[0], /https?:\/\/|private\.sqlite|priceCents|sourceProductId|access_token/i)
    assert.equal((await stat(destination)).mode & 0o777, 0o600)
    const bytes = await readFile(destination)
    const entries = await readdir(directory)
    await refused(() => main(['--out', destination], () => { messages.push('FORBIDDEN') }))
    assert.equal(messages.length, 1, 'failed re-run must never print a second report')
    assert.deepEqual(await readFile(destination), bytes)
    assert.deepEqual(await readdir(directory), entries)
  })
})
