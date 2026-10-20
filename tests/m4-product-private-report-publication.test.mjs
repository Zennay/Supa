import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmod, link, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Synthetic abandoned beta only: fictional closed M3 is a validator fixture,
// NOT real consent, live M3 evidence, or authorization to recruit beta users.
function abandonedSession() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'm4-private-output-fixture',
    participantKey: 'opaque-qa-participant',
    population: 'fictional students',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'fictional-gate-not-real' },
    startedAt: '2026-10-10T10:00:00Z',
    endedAt: '2026-10-10T11:00:00Z',
    events: [{
      type: 'beta_session_started',
      timestamp: '2026-10-10T10:00:00Z',
      participant_id: 'opaque-qa-participant',
      study_week_id: 'fictitious-week',
    }],
  }
}

function invoke(args) {
  return spawnSync(process.execPath, [
    'scripts/m4-validate-beta-session.mjs', ...args,
  ], { cwd: process.cwd(), encoding: 'utf8' })
}

async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m4-private-publish-'))
  const input = join(directory, 'private-source.json')
  const raw = JSON.stringify(abandonedSession())
  try {
    await writeFile(input, raw, { mode: 0o600 })
    await fn({ directory, input, raw })
    assert.equal(await readFile(input, 'utf8'), raw, 'raw study source must never be modified')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function assertNoStagingFiles(directory) {
  const entries = await readdir(directory)
  assert.deepEqual(entries.filter((entry) => entry.endsWith('.tmp')), [], 'staging file must be removed')
}

test('M4 publishes a valid fictional report privately at a new path, no stdout or source mutation', async () => {
  await fixture(async ({ directory, input }) => {
    const target = join(directory, 'report.json')
    const run = invoke([input, '--output', target])
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '')
    const summary = JSON.parse(await readFile(target, 'utf8'))
    assert.equal(summary.reportType, 'm4-private-beta-session-summary')
    assert.equal(summary.sessionOutcome, 'abandoned')
    assert.equal(summary.publicClaimEligible, false)
    assert.equal('participantKey' in summary, false)
    assert.equal((await lstat(target)).mode & 0o077, 0, 'private report must never have group/other permission bits')
    await assertNoStagingFiles(directory)
  })
})

test('M4 private output stays mode 0600 even under permissive child umask 022', async () => {
  await fixture(async ({ directory, input }) => {
    const target = join(directory, 'report.json')
    const wrapper = [
      'process.umask(0o022);',
      'const mod = await import("./scripts/m4-validate-beta-session.mjs");',
      'await mod.main(process.argv.slice(1));',
    ].join(' ')
    const run = spawnSync(process.execPath, [
      '--input-type=module', '--eval', wrapper, input, '--output', target,
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '')
    assert.equal((await lstat(target)).mode & 0o777, 0o600)
  })
})

test('M4 rejects a report path equal to original private evidence file', async () => {
  await fixture(async ({ directory, input }) => {
    const run = invoke([input, '--output', input])
    assert.notEqual(run.status, 0)
    assert.equal(run.stdout, '')
    await assertNoStagingFiles(directory)
  })
})

test('M4 rejects a hardlink of the input and leaves its original inode unchanged', async () => {
  await fixture(async ({ directory, input, raw }) => {
    const target = join(directory, 'evidence-hardlink.json')
    await link(input, target)
    const run = invoke([input, '--output', target])
    assert.notEqual(run.status, 0)
    assert.equal(run.stdout, '')
    assert.equal(await readFile(target, 'utf8'), raw)
    await assertNoStagingFiles(directory)
  })
})

test('M4 rejects a symlink pointing at the evidence source without unlinking the alias', async () => {
  await fixture(async ({ directory, input, raw }) => {
    const target = join(directory, 'evidence-symlink.json')
    await symlink(input, target)
    const run = invoke([input, '--output', target])
    assert.notEqual(run.status, 0)
    assert.equal(run.stdout, '')
    assert.equal(await readFile(target, 'utf8'), raw)
    assert.equal((await lstat(target)).isSymbolicLink(), true)
    await assertNoStagingFiles(directory)
  })
})

test('M4 refuses overwriting even an existing already-public 0644 destination', async () => {
  await fixture(async ({ directory, input }) => {
    const target = join(directory, 'public-legacy.json')
    const old = 'SENTINEL - must remain intact'
    await writeFile(target, old, { mode: 0o644 })
    await chmod(target, 0o644)
    const run = invoke([input, '--output', target])
    assert.notEqual(run.status, 0)
    assert.equal(run.stdout, '')
    assert.equal(await readFile(target, 'utf8'), old)
    assert.equal((await lstat(target)).mode & 0o777, 0o644)
    await assertNoStagingFiles(directory)
  })
})

for (const [label, argv] of [
  ['missing --output value', ['--output']],
  ['duplicate --output flags', ['--output', 'first.json', '--output', 'second.json']],
  ['flag-valued --output destination', ['--output', '--output']],
  ['unrecognized flag', ['--unexpected-flag']],
]) {
  test(`M4 CLI rejects ${label} before output or report disclosure`, async () => {
    await fixture(async ({ directory, input }) => {
      const args = argv.map((arg) => arg.endsWith('.json') ? join(directory, arg) : arg)
      const run = invoke([input, ...args])
      assert.notEqual(run.status, 0)
      assert.equal(run.stdout, '', 'no private output must print on malformed output options')
      assert.doesNotMatch(run.stderr, /opaque-qa-participant|fictional students/)
      assert.deepEqual(await readdir(directory), ['private-source.json'])
    })
  })
}
