import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import {
  inspectPrivateM3FieldKit,
  renderPrivateM3FieldKitText,
  main,
} from '../scripts/qa-m3-private-operator-fieldkit-20261017.mjs'
import { buildPrivateM3FieldProgress } from '../scripts/m3-private-field-progress.mjs'
import { buildM3OutstandingFieldActions } from '../scripts/m3-private-outstanding-field-actions.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/qa-m3-private-operator-fieldkit-20261017.mjs', import.meta.url))
const CLOCK = Date.parse('2026-10-17T12:00:00Z')
const CANARY = 'PRIVATE_USER_CANARY_QA_NEVER_ECHO_9382'
async function stage() {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-fieldkit-private-'))
  const dir = join(root, 'owner')
  await mkdir(dir, { mode: 0o700 })
  const path = join(dir, 'case.json')
  const sheet = buildObservationSheet()
  sheet.study.participantKey = CANARY
  await writeFile(path, JSON.stringify(sheet), { mode: 0o600, flag: 'wx' })
  return { root, dir, path, sheet }
}
const cleanup = x => rm(x.root, { recursive: true, force: true })
function checkNoRelease(result) {
  assert.equal(result.mode, 'independent-private-m3-operator-fieldkit')
  assert.equal(result.projectMilestone, 'M3')
  assert.equal(result.dataStatus, 'unverified-operator-draft')
  assert.equal(result.totalExpectedLines, 22)
  assert.equal(result.totalCompletedLines + result.totalMissingLines, 22)
  assert.deepEqual(result.stores.map(x => x.retailer), ['PLUS','DekaMarkt'])
  assert.equal(result.independentRetailerRightsVerified, false)
  assert.equal(result.actualPairedShopVisitVerified, false)
  assert.equal(result.physicalCodePinVerified, false)
  assert.equal(result.permanentSelfHostedJobAttested, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.externalRequests, 0)
  assert.equal(result.releaseDecision, 'hold')
  assert.equal(result.blockers.at(-1), 'permanent-vps-runner-proof-not-independently-attested')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_USER_CANARY|https?:\/\/|sourceProductId|currentPriceCents|capturedAt|fieldRunCommitSha|offerPriceCents|secret/i)
}
function subprocess(argv, cwd = undefined) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...argv],
    { encoding: 'utf8', cwd, timeout: 15_000, maxBuffer: 128 * 1024 })
  assert.equal(child.error, undefined)
  assert.equal((child.stdout + child.stderr).includes(CANARY), false)
  return child
}
function refuse(file) {
  const child = subprocess(['--file', file])
  assert.equal(child.status, 2, 'file admission must fail')
  assert.equal(child.stdout, '')
  assert.equal(child.stderr, 'Independent private M3 operator fieldkit refused\n')
  assert.equal(child.stderr.includes(file), false)
}

describe('M3 actionable secure private fieldkit: local operator evidence and external HOLD', () => {
  it('real canonical 22-line draft reports both independent progress projections on exact input', () => {
    const sheet = buildObservationSheet()
    sheet.study.participantKey = CANARY
    const bytes = JSON.stringify(sheet)
    const report = inspectPrivateM3FieldKit(bytes, CLOCK)
    const progress = buildPrivateM3FieldProgress(bytes, CLOCK)
    const outstanding = buildM3OutstandingFieldActions(bytes, CLOCK)
    checkNoRelease(report)
    assert.equal(report.totalCompletedLines, progress.progress.completeLines)
    assert.equal(report.totalMissingLines, outstanding.remainingTotalLines)
    assert.equal(report.readyForPrivateHumanReview, outstanding.readyForPrivateReview)
    assert.equal(report.stores[0].missingLines, outstanding.retailers[0].remainingLines)
    assert.equal(report.stores[1].missingLines, outstanding.retailers[1].remainingLines)
    assert.equal(report.totalCompletedLines, 0)
    assert.equal(report.totalMissingLines, 22)
  })
  it('same bytes+clock are deterministic without price/participant leakage', () => {
    const raw = JSON.stringify(buildObservationSheet())
    const a = inspectPrivateM3FieldKit(raw, CLOCK)
    const b = inspectPrivateM3FieldKit(raw, CLOCK)
    assert.deepEqual(a, b)
    checkNoRelease(a)
  })
  it('actual strict owner-0600 CLI JSON and Dutch text both safe, unchanged source', async () => {
    const work = await stage()
    try {
      const before = await readFile(work.path)
      const json = subprocess(['--file', work.path])
      assert.equal(json.status, 0, json.stderr)
      assert.equal(json.stderr, '')
      checkNoRelease(JSON.parse(json.stdout))
      const text = subprocess(['--file', work.path, '--text'])
      assert.equal(text.status, 0, text.stderr)
      assert.match(text.stdout, /PLUS: 11 van 11 open\./)
      assert.match(text.stdout, /DekaMarkt: 11 van 11 open\./)
      assert.match(text.stdout, /M3 productievrijgave: NEE/)
      assert.equal(text.stdout.includes(CANARY), false)
      assert.deepEqual(await readFile(work.path), before)
    } finally { await cleanup(work) }
  })
  it('group/world-readable private drafts are rejected before parsing', async () => {
    const x = await stage()
    try {
      for (const mode of [0o640, 0o644, 0o666]) {
        await chmod(x.path, mode)
        refuse(x.path)
      }
    } finally { await cleanup(x) }
  })
  it('leaf and parent symlinks cannot redirect operator data', async () => {
    const x = await stage()
    try {
      const alias = join(x.root, 'alias.json')
      await symlink(x.path, alias)
      refuse(alias)
      const aliasDir = join(x.root, 'alias-dir')
      await symlink(x.dir, aliasDir, 'dir')
      refuse(join(aliasDir, 'case.json'))
    } finally { await cleanup(x) }
  })
  it('hardlinked originals cannot be used as proof of a private single-link source', async () => {
    const x = await stage()
    try {
      await link(x.path, join(x.root, 'second-link.json'))
      refuse(x.path)
    } finally { await cleanup(x) }
  })
  it('oversized, malformed UTF-8, and malformed canonical JSON are rejected without output', async () => {
    const x = await stage()
    try {
      for (const bytes of [
        Buffer.alloc(2 * 1024 * 1024 + 1, 0x20),
        Buffer.from([0x7b, 0xff, 0x7d]),
        Buffer.from('{"study":"PRIVATE_USER_CANARY_QA_NEVER_ECHO_9382"}'),
      ]) {
        await writeFile(x.path, bytes, { mode: 0o600 })
        refuse(x.path)
      }
    } finally { await cleanup(x) }
  })
  it('refuses unsupported flags, missing inputs, untrusted URLs and file aliases', async () => {
    const x = await stage()
    try {
      for (const args of [
        [], ['--publish'], ['--file'], ['--file', x.path, '--publish'],
        ['--file', x.path, '--text', '--release'],
        ['--file', x.path, 'https://example.invalid'],
        ['--file', 'https://example.invalid'],
        ['--file', x.path + '\0'],
        ['--file', x.root],
      ]) {
        const child = subprocess(args)
        assert.equal(child.status, 2)
        assert.equal(child.stdout, '')
        assert.equal(child.stderr, 'Independent private M3 operator fieldkit refused\n')
      }
    } finally { await cleanup(x) }
  })
  it('malicious programmatic argv getters and Proxies fail before executing traps', async () => {
    let traps = 0
    const getter = ['--file','/example']
    Object.defineProperty(getter, '1', {
      enumerable: true, get() { traps++; throw Error('PRIVATE_USER_CANARY') },
    })
    const inputs = [
      getter,
      new Proxy(['--file','/tmp/none'], { get() { traps++; throw Error('CANARY') } }),
      Object.assign(['--file','/tmp/none'], { unexpected: true }),
      Object.setPrototypeOf(['--file','/tmp/none'], null),
    ]
    for (const args of inputs) {
      let out = ''
      await assert.rejects(main(args, data => { out += data }), /Independent private M3 operator fieldkit refused/)
      assert.equal(out, '')
    }
    assert.equal(traps, 0)
  })
  it('pure protocol rejects corrupt snapshots and impossible test clocks; text refuses unsanitized objects', () => {
    for (const raw of ['{}', '[]', '', 'bad', '\ufeff{}']) {
      assert.throws(() => inspectPrivateM3FieldKit(raw, CLOCK),
        /Independent private M3 operator fieldkit refused/)
    }
    assert.throws(() => inspectPrivateM3FieldKit(JSON.stringify(buildObservationSheet()), NaN),
      /Independent private M3 operator fieldkit refused/)
    assert.throws(() => renderPrivateM3FieldKitText({ mode: 'published' }),
      /Independent private M3 operator fieldkit refused/)
  })
})
