import assert from 'node:assert/strict'
import test from 'node:test'
import { access, link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { main } from '../scripts/m4-validate-beta-session.mjs'

// All file writes are scoped to an automatically cleaned temporary directory.
// Synthetic M3 "closed" is a validator precondition, NOT genuine field proof.
function fictionalInput() {
  return {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'fictional-m4-inode-qa-001',
    participantKey: 'fictional-pseudonym',
    population: 'fictional students',
    sessionOutcome: 'abandoned',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-only-M3-closed-fixture' },
    startedAt: '2026-10-12T10:00:00.000Z',
    endedAt: '2026-10-12T10:10:00.000Z',
    events: [{
      type: 'beta_session_started',
      timestamp: '2026-10-12T10:00:00.000Z',
      participant_id: 'fictional-pseudonym',
      study_week_id: 'fictional-week',
    }],
  }
}

async function withIsolatedSession(check) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-m4-output-inode-'))
  const input = join(folder, 'private-source.json')
  const bytes = JSON.stringify(fictionalInput(), null, 2) + '\n'
  try {
    await writeFile(input, bytes, 'utf8')
    await check({ folder, input, bytes })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

test('positive: separate M4 report path preserves byte-identical private source data', async () => {
  await withIsolatedSession(async ({ folder, input, bytes }) => {
    const output = join(folder, 'derived-summary.json')
    const summary = await main([input, '--output', output])
    assert.equal(await readFile(input, 'utf8'), bytes)
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.deepEqual(report, summary)
    assert.equal(report.reportType, 'm4-private-beta-session-summary')
    assert.equal(report.publicClaimEligible, false)
    assert.equal(report.participantKeyIncluded, false)
    assert.doesNotMatch(JSON.stringify(report), /fictional-pseudonym/)
  })
})

for (const kind of ['same-path', 'symlink', 'hardlink']) {
  test(`EXPECTED RED: M4 report output via ${kind} cannot destroy its own original session`, async () => {
    await withIsolatedSession(async ({ folder, input, bytes }) => {
      const alias = join(folder, 'alias.json')
      if (kind === 'symlink') await symlink(input, alias)
      if (kind === 'hardlink') await link(input, alias)
      const output = kind === 'same-path' ? input : alias

      let caught = null
      try {
        await main([input, '--output', output])
      } catch (error) {
        caught = error
      }

      // Must still hold even when the validator erroneously returns success.
      assert.equal(await readFile(input, 'utf8'), bytes,
        `${kind}: the only source of private events was destructively replaced by summary`)
      assert.ok(caught instanceof Error, `${kind}: output/source alias must be rejected`)
      assert.match(caught.message,
        /source|input|same|alias|inode|output|protected/i,
        `${kind}: report write needs a documented fail-closed source-preservation error`)
      if (kind !== 'same-path') await access(alias)
    })
  })
}
