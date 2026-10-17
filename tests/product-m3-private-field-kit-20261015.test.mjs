import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildM3FieldKit,
  writeM3FieldKit,
} from '../scripts/m3-prepare-field-kit.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

// All files are UNFILLED fictional operator paperwork; no retailer HTTP,
// participants, prices, consent or real observed study is ever synthesized.
const FAKE_MAIN_SHA = 'a'.repeat(40)
const revision = () => ({ branch: 'main', sha: FAKE_MAIN_SHA })

test('private field kit derives the exact current canonical 11 + 11 requirements without a price', () => {
  const kit = buildM3FieldKit(revision())
  assert.deepEqual(Object.keys(kit).sort(), [
    'START-HERE.txt', 'collection-sheet.json', 'field-form.html', 'source-revision.json',
  ].sort())
  const sheet = JSON.parse(kit['collection-sheet.json'])
  const canonical = buildObservationSheet()
  assert.deepEqual(sheet, canonical)
  assert.equal(sheet.requirements.length, 11)
  for (const side of ['baseline', 'candidate']) {
    assert.deepEqual(sheet[side].lines.map((row) => row.ingredientId),
      sheet.requirements.map((requirement) => requirement.id))
    for (const row of sheet[side].lines) {
      assert.equal(row.observedProduct.available, null)
      assert.equal(row.observedProduct.priceCents, null)
      assert.equal(row.observedProduct.productName, '')
    }
  }
  assert.match(kit['field-form.html'], /data-m3-side="baseline"/u)
  assert.match(kit['field-form.html'], /data-m3-side="candidate"/u)
  assert.equal((kit['field-form.html'].match(/data-m3-row="/gu) || []).length, 22)
})

test('kit commits current main pin and stable canonical demand checksum as companion ONLY', () => {
  const kit = buildM3FieldKit(revision())
  const pin = JSON.parse(kit['source-revision.json'])
  assert.equal(pin.sourceBranch, 'main')
  assert.equal(pin.sourceCommitSha, FAKE_MAIN_SHA)
  assert.match(pin.canonicalDemandSha256, /^[0-9a-f]{64}$/u)
  assert.equal(pin.verifiedRetailerObservations, false)
  assert.equal(pin.publicSavingsClaimEligible, false)
  assert.equal(pin.evidenceStatus, 'collection-kit-not-evidence')
  assert.match(pin.notice, /Issue #205/u)
  assert.match(kit['START-HERE.txt'], /issue #205/u)
  assert.match(kit['START-HERE.txt'], /#78/u)
  assert.match(kit['START-HERE.txt'], /#74/u)
  assert.ok(!Object.hasOwn(JSON.parse(kit['collection-sheet.json']).study, 'sourceCommitSha'),
    'companion provenance is not falsely represented as persisted inside study schema')
})

test('wrong branch, short or spoofed revision can never create an attested kit', () => {
  for (const invalid of [
    null, {}, { branch: 'feature', sha: FAKE_MAIN_SHA },
    { branch: 'main', sha: 'abc' },
    { branch: 'main', sha: 'A'.repeat(40) },
    { branch: 'main', sha: 'g'.repeat(40) },
    { branch: 'main', sha: new String(FAKE_MAIN_SHA) },
  ]) {
    assert.throws(() => buildM3FieldKit(invalid), /clean main checkout/u)
  }
})

test('two identical main pins produce a byte-identical deterministic empty operator bundle', () => {
  assert.deepEqual(buildM3FieldKit(revision()), buildM3FieldKit(revision()))
  assert.notDeepEqual(buildM3FieldKit(revision()),
    buildM3FieldKit({ branch: 'main', sha: 'b'.repeat(40) }))
})

test('private kit writes four new 0600 files into exclusive 0700 directory and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-kit-'))
  try {
    const destination = join(root, 'private-field-visit')
    const kit = buildM3FieldKit(revision())
    const result = await writeM3FieldKit(destination, kit)
    assert.equal(result.sourceCommitSha, FAKE_MAIN_SHA)
    assert.equal(result.files.length, 4)
    assert.equal((await lstat(destination)).mode & 0o777, 0o700)
    for (const name of result.files) {
      assert.equal((await lstat(join(destination, name))).mode & 0o777, 0o600)
      assert.equal(await readFile(join(destination, name), 'utf8'), kit[name])
    }
    assert.deepEqual(JSON.parse(await readFile(join(destination, 'collection-sheet.json'), 'utf8')),
      buildObservationSheet())
    await assert.rejects(writeM3FieldKit(destination, kit))
    assert.equal(await readFile(join(destination, 'START-HERE.txt'), 'utf8'), kit['START-HERE.txt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('existing destination files and symlinked parent aliases never become kit targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-existing-'))
  try {
    const occupied = join(root, 'occupied')
    await writeFile(occupied, 'KEEP ME', 'utf8')
    const kit = buildM3FieldKit(revision())
    await assert.rejects(writeM3FieldKit(occupied, kit))
    assert.equal(await readFile(occupied, 'utf8'), 'KEEP ME')
    const realParent = join(root, 'real')
    await mkdir(realParent)
    const alias = join(root, 'shortcut')
    await symlink(realParent, alias, 'dir')
    await assert.rejects(writeM3FieldKit(join(alias, 'new'), kit),
      /symlinked M3 output parent/u)
    assert.deepEqual(await (await import('node:fs/promises')).readdir(realParent), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('blank kit rejects malformed destinations or incomplete data before writing anything', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-invalid-'))
  try {
    const kit = buildM3FieldKit(revision())
    for (const path of ['', '  ', '-nope', 'bad\u0000path', 'bad\npath']) {
      await assert.rejects(writeM3FieldKit(path, kit))
    }
    await assert.rejects(writeM3FieldKit(join(root, 'invalid'), {
      'collection-sheet.json': '{}',
    }), /incomplete blank M3 field kit/u)
    const { readdir } = await import('node:fs/promises')
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})



test('exported private writer rejects forged or prefilled kit bytes before creating a directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-kit-integrity-'))
  try {
    const original = buildM3FieldKit(revision())
    const prefills = [
      { ...original, 'collection-sheet.json': original['collection-sheet.json']
        .replace('"available": null', '"available": true') },
      { ...original, 'field-form.html': original['field-form.html'] + '<script>unsafe</script>' },
      { ...original, 'START-HERE.txt': original['START-HERE.txt'] + 'Prijs: € 0' },
      { ...original, 'source-revision.json': JSON.stringify({
        ...JSON.parse(original['source-revision.json']), canonicalDemandSha256: '0'.repeat(64),
      }) },
      { ...original, 'source-revision.json': '{broken' },
    ]
    for (const [index, kit] of prefills.entries()) {
      const output = join(root, 'invalid-' + index)
      await assert.rejects(writeM3FieldKit(output, kit))
      await assert.rejects(lstat(output), { code: 'ENOENT' })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('private collection kit never writes under the Git source tree, even with dot-dot paths', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const kit = buildM3FieldKit(revision())
  const candidate = join(root, 'artifacts', 'private-m3-should-not-exist-20261015')
  const paths = [
    root,
    candidate,
    join(root, 'tests', '..', 'private-m3-should-not-exist-20261015'),
    join(root, '.git', 'private-m3-should-not-exist-20261015'),
  ]
  for (const path of paths) {
    await assert.rejects(writeM3FieldKit(path, kit), /inside source repository/u)
  }
  await assert.rejects(lstat(candidate), { code: 'ENOENT' })
})

test('exported writer rejects getter-swapped prices and forged proof flags before creating output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-getter-refusal-'))
  try {
    const canonical = buildM3FieldKit(revision())
    for (const filename of ['collection-sheet.json', 'source-revision.json']) {
      const destination = join(root, filename.replace(/[^a-z]/gu, '-'))
      const caller = { ...canonical }
      let reads = 0
      Object.defineProperty(caller, filename, {
        enumerable: true,
        configurable: true,
        get() {
          reads += 1
          if (reads < 3) return canonical[filename]
          if (filename === 'collection-sheet.json') {
            return canonical[filename].replace('"available": null', '"available": true')
          }
          return canonical[filename].replace('"publicSavingsClaimEligible": false',
            '"publicSavingsClaimEligible": true')
        },
      })
      await assert.rejects(writeM3FieldKit(destination, caller), /incomplete blank M3 field kit/u)
      assert.equal(reads, 0, 'a dynamic accessor must never be called while validating private evidence')
      await assert.rejects(lstat(destination), { code: 'ENOENT' })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('exported writer pins validated bytes, not later Proxy get traps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-proxy-snapshot-'))
  try {
    const canonical = buildM3FieldKit(revision())
    let gets = 0
    const dynamic = new Proxy(canonical, {
      get(target, property) {
        gets += 1
        if (property === 'source-revision.json') {
          return target[property].replace('"verifiedRetailerObservations": false',
            '"verifiedRetailerObservations": true')
        }
        return target[property]
      },
    })
    const destination = join(root, 'private-output')
    await writeM3FieldKit(destination, dynamic)
    assert.equal(gets, 0, 'accessors and Proxy get traps cannot override pinned bytes')
    for (const [file, bytes] of Object.entries(canonical)) {
      assert.equal(await readFile(join(destination, file), 'utf8'), bytes)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('exported writer rejects symbols, inherited and malformed descriptor records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-descriptor-guard-'))
  try {
    const original = buildM3FieldKit(revision())
    const inherited = Object.create({ 'START-HERE.txt': original['START-HERE.txt'] })
    for (const key of ['collection-sheet.json', 'field-form.html', 'source-revision.json']) {
      inherited[key] = original[key]
    }
    const symbol = { ...original, [Symbol('unexpected')]: 'private' }
    const throwingProxy = new Proxy(original, {
      ownKeys() { throw new Error('PRIVATE-SENTINEL-DO-NOT-LOG') },
    })
    for (const [index, input] of [inherited, symbol, throwingProxy].entries()) {
      const output = join(root, 'denied-' + index)
      await assert.rejects(writeM3FieldKit(output, input), /incomplete blank M3 field kit/u)
      await assert.rejects(lstat(output), { code: 'ENOENT' })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('private field kit refuses OTHER Git repositories, worktrees and uncreated descendants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-cross-git-'))
  const kit = buildM3FieldKit(revision())
  try {
    const checkout = join(root, 'another-app')
    await mkdir(checkout)
    await mkdir(join(checkout, '.git'))
    const nested = join(checkout, 'not-yet-existing', 'very-private-kit')
    await assert.rejects(writeM3FieldKit(nested, kit), /under a Git checkout/u)
    await assert.rejects(lstat(join(checkout, 'not-yet-existing')), { code: 'ENOENT' })

    // Additional worktrees identify their Git root using a .git FILE.
    const worktree = join(root, 'linked-worktree')
    await mkdir(worktree)
    await writeFile(join(worktree, '.git'), 'gitdir: /synthetic/example/worktrees/test\n')
    const worktreeOutput = join(worktree, 'private-kit')
    await assert.rejects(writeM3FieldKit(worktreeOutput, kit), /under a Git checkout/u)
    await assert.rejects(lstat(worktreeOutput), { code: 'ENOENT' })

    // Never create a source-control metadata folder as an output destination.
    const markerOutput = join(root, '.git')
    await assert.rejects(writeM3FieldKit(markerOutput, kit), /under a Git checkout/u)
    await assert.rejects(lstat(markerOutput), { code: 'ENOENT' })

    // The control outside all Git repositories still works exactly as before.
    const allowed = join(root, 'outside-all-checkouts')
    await writeM3FieldKit(allowed, kit)
    assert.equal((await lstat(allowed)).mode & 0o777, 0o700)
    assert.equal(await readFile(join(allowed, 'source-revision.json'), 'utf8'),
      kit['source-revision.json'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('revision provenance rejects getter swaps and inherited or extra metadata before producing kit', () => {
  const fake = 'a'.repeat(40)
  const altered = 'b'.repeat(40)
  let reads = 0
  const getterRevision = { branch: 'main' }
  Object.defineProperty(getterRevision, 'sha', {
    enumerable: true,
    get() {
      reads += 1
      return reads <= 2 ? fake : altered
    },
  })
  assert.throws(() => buildM3FieldKit(getterRevision), /exact clean main checkout/u)
  assert.equal(reads, 0, 'unsafe revision getter must never run')
  const inherited = Object.create({ branch: 'main' })
  inherited.sha = fake
  assert.throws(() => buildM3FieldKit(inherited), /exact clean main checkout/u)
  assert.throws(() => buildM3FieldKit({ branch: 'main', sha: fake, extra: 'x' }),
    /exact clean main checkout/u)
  assert.throws(() => buildM3FieldKit({ branch: 'main', sha: fake, [Symbol('hidden')]: 7 }),
    /exact clean main checkout/u)
})

test('revision Proxy get trap never changes pinned SHA between companion and human guide', () => {
  const fake = 'c'.repeat(40)
  let reads = 0
  const revision = new Proxy({ branch: 'main', sha: fake }, {
    get(target, key) {
      reads += 1
      if (key === 'sha') return 'd'.repeat(40)
      return target[key]
    },
  })
  const kit = buildM3FieldKit(revision)
  assert.equal(reads, 0, 'strict data descriptor snapshot avoids dynamic get traps')
  const sidecar = JSON.parse(kit['source-revision.json'])
  assert.equal(sidecar.sourceCommitSha, fake)
  assert.match(kit['START-HERE.txt'], new RegExp('Codeversie main: ' + fake))
  assert.doesNotMatch(kit['START-HERE.txt'], /dddddddddddddddddddddddddddddddddddddddd/u)
  assert.throws(() => buildM3FieldKit(new Proxy({ branch: 'main', sha: fake }, {
    ownKeys() { throw new Error('PRIVATE-DRAFT-PATH-DO-NOT-ECHO') },
  })), /exact clean main checkout/u)
})
