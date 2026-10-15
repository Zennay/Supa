import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildM3FieldKit, writeM3FieldKit } from '../scripts/m3-prepare-field-kit.mjs'

// Independent offline QA on exact pinned product owner SHA fd1459f.
// Do not generate real retailer observations or publish private output.
const SHA = 'e'.repeat(40)
const blankKit = () => buildM3FieldKit({ branch: 'main', sha: SHA })

test('M3 provenance rejects both branch and SHA accessors without executing private getters', () => {
  for (const property of ['branch', 'sha']) {
    const revision = { branch: 'main', sha: SHA }
    let getterCalls = 0
    Object.defineProperty(revision, property, {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1
        throw new Error('PRIVATE-UNTRUSTED-SOURCE')
      },
    })
    assert.throws(() => buildM3FieldKit(revision), (error) => {
      assert.match(error.message, /exact clean main checkout/u)
      assert.doesNotMatch(error.message, /PRIVATE-UNTRUSTED-SOURCE/u)
      return true
    })
    assert.equal(getterCalls, 0, 'revision accessor must never be executed')
  }
})

test('M3 revision Proxy reflection failure refuses without echoing private exception', () => {
  for (const traps of [
    { ownKeys() { throw new Error('PRIVATE-DRAFT-REFERENCE-NEVER-PRINT') } },
    { getOwnPropertyDescriptor() { throw new Error('PRIVATE-DRAFT-REFERENCE-NEVER-PRINT') } },
  ]) {
    assert.throws(() => buildM3FieldKit(new Proxy({ branch: 'main', sha: SHA }, traps)),
      (error) => {
        assert.match(error.message, /exact clean main checkout/u)
        assert.doesNotMatch(error.message, /PRIVATE-DRAFT-REFERENCE-NEVER-PRINT/u)
        return true
      })
  }
})

test('M3 valid Proxy getters cannot swap revision between guide and provenance', () => {
  let directGetCalls = 0
  const revision = new Proxy({ branch: 'main', sha: SHA }, {
    get(target, property) {
      directGetCalls += 1
      return property === 'sha' ? 'f'.repeat(40) : target[property]
    },
  })
  const kit = buildM3FieldKit(revision)
  assert.equal(directGetCalls, 0)
  assert.equal(JSON.parse(kit['source-revision.json']).sourceCommitSha, SHA)
  assert.match(kit['START-HERE.txt'], new RegExp('Codeversie main: ' + SHA))
  assert.doesNotMatch(kit['START-HERE.txt'], /ffffffffffffffffffffffffffffffffffffffff/u)
  assert.equal(JSON.parse(kit['source-revision.json']).publicSavingsClaimEligible, false)
})

test('M3 private field kit refuses foreign Git marker symlink and dangling Git marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-crossrepo-gitmarker-'))
  const kit = blankKit()
  try {
    const real = join(root, 'target')
    await mkdir(real)
    await writeFile(join(real, 'unrelated.txt'), 'UNCHANGED', 'utf8')
    for (const [label, markerTarget] of [
      ['linked-git', real],
      ['dangling-git', join(root, 'missing-target')],
    ]) {
      const checkout = join(root, label)
      await mkdir(checkout)
      await symlink(markerTarget, join(checkout, '.git'))
      const proposed = join(checkout, 'not-created', 'private-observations')
      await assert.rejects(writeM3FieldKit(proposed, kit), /under a Git checkout/u)
      await assert.rejects(lstat(join(checkout, 'not-created')), { code: 'ENOENT' })
    }
    assert.equal(await readFile(join(real, 'unrelated.txt'), 'utf8'), 'UNCHANGED')
    const safe = join(root, 'private-outside-all-git')
    await writeM3FieldKit(safe, kit)
    assert.equal((await lstat(safe)).mode & 0o777, 0o700)
    assert.equal((await lstat(join(safe, 'source-revision.json'))).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await readFile(join(safe, 'source-revision.json'), 'utf8'))
      .publicSavingsClaimEligible, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
