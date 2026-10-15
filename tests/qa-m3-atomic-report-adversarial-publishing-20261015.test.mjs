import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// QA 2/2, fully fictional offline input. The product branch owns the
// publication implementation; these independent tests only inspect its
// filesystem side effects, including competing *different* report payloads.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-publish-atomic-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const plus = join(root, 'plus.html')
  const deka = join(root, 'deka.html')
  await writeFile(plus, '<html>fictional PLUS no product price</html>')
  await writeFile(deka, '<html>fictional Deka no product price</html>')
  const capturedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  const manifests = {}
  for (const [label, query] of [['a', 'fictional alpha milk'], ['b', 'fictional beta milk']]) {
    const filename = join(root, 'manifest-' + label + '.json')
    await writeFile(filename, JSON.stringify({
      version: 1,
      requirements: [{ id: 'milk-' + label, query, amount: 1000, unit: 'ml' }],
      snapshots: [
        { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html', capturedAt },
        { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html', capturedAt },
      ],
    }))
    manifests[label] = filename
  }
  return { root, plus, deka, manifests, output: join(root, 'private-report.json') }
}
async function noTemporaryFiles(root) {
  const all = await readdir(root)
  assert.deepEqual(all.filter(name => name.startsWith('.supa-m3-')), [])
}
async function validPrivateReport(path) {
  const raw = await readFile(path, 'utf8')
  const report = JSON.parse(raw)
  assert.equal(report.format, 'supa-local-snapshot-comparison-v1')
  assert.equal(report.comparison.claimable, false)
  assert.equal(report.comparison.comparable, false)
  assert.equal(report.comparison.savingsCents, null)
  assert.equal(report.comparison.cheaperStore, null)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  return { raw, report }
}
test('QA: twelve differently sourced writers publish exactly one intact private report', async t => {
  const f = await fixture(t)
  const expectedA = JSON.stringify(await compareLocalRetailerSnapshots(f.manifests.a), null, 2) + '\n'
  const expectedB = JSON.stringify(await compareLocalRetailerSnapshots(f.manifests.b), null, 2) + '\n'
  assert.notEqual(expectedA, expectedB, 'independent reports must truly be different')
  const result = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
    main([i % 2 ? f.manifests.a : f.manifests.b, '--out', f.output])))
  assert.equal(result.filter(x => x.status === 'fulfilled').length, 1)
  for (const failure of result.filter(x => x.status === 'rejected')) {
    assert.match(String(failure.reason), /EEXIST/)
  }
  const { raw } = await validPrivateReport(f.output)
  assert.ok(raw === expectedA || raw === expectedB, 'no interleaved/mixed data permitted')
  await noTemporaryFiles(f.root)
})
for (const [label, key] of [
  ['manifest input', 'manifest'],
  ['PLUS source HTML', 'plus'],
  ['DekaMarkt source HTML', 'deka'],
]) {
  test('QA: report output alias to existing ' + label + ' never changes the input', async t => {
    const f = await fixture(t)
    const target = key === 'manifest' ? f.manifests.a : f[key]
    const bytes = await readFile(target)
    await assert.rejects(main([f.manifests.a, '--out', target]), /EEXIST/)
    assert.deepEqual(await readFile(target), bytes)
    await noTemporaryFiles(f.root)
  })
}
test('QA: dangling target symlink remains an unmodified owner path', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'non-existent-owner-target.json')
  await symlink(target, f.output)
  await assert.rejects(main([f.manifests.a, '--out', f.output]), /EEXIST/)
  assert.equal((await readdir(f.root)).includes('private-report.json'), true)
  await assert.rejects(stat(target), { code: 'ENOENT' })
  await noTemporaryFiles(f.root)
})
test('QA: output target directory collision never leaks temporary report', async t => {
  const f = await fixture(t)
  await assert.rejects(main([f.manifests.a, '--out', f.root]), /EEXIST|EPERM/)
  await noTemporaryFiles(f.root)
})
test('QA: non-existent output parent cannot leave a stray report beside inputs', async t => {
  const f = await fixture(t)
  await assert.rejects(main([f.manifests.a, '--out', join(f.root, 'missing-subdir', 'report.json')]), /ENOENT/)
  await noTemporaryFiles(f.root)
  await assert.rejects(stat(f.output), { code: 'ENOENT' })
})
test('QA: valid output remains immutable and byte-exact after a losing second writer', async t => {
  const f = await fixture(t)
  await main([f.manifests.a, '--out', f.output])
  const original = await validPrivateReport(f.output)
  await assert.rejects(main([f.manifests.b, '--out', f.output]), /EEXIST/)
  const final = await validPrivateReport(f.output)
  assert.equal(final.raw, original.raw)
  assert.deepEqual(final.report, original.report)
  await noTemporaryFiles(f.root)
})
