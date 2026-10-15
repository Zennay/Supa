import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Always use argv arrays: never a shell, network, credentials, or real retailer
// price paths. Refused CLI diagnostics must not echo any operator-supplied
// URL/token or accidentally create a user-facing priced comparison.
const paths = [
  fileURLToPath(new URL('../scripts/retailer-reviewed-custom-week.mjs', import.meta.url)),
  fileURLToPath(new URL('../scripts/retailer-private-sqlite-planner-review.mjs', import.meta.url)),
]

const invalid = [
  ['--plan'],
  ['--plan', ''],
  ['--plan', 'Ma:unknown'],
  ['--plan', 'Ma:Pasta'],
  ['--plan', 'Vr:pasta'],
  ['--plan', 'Ma:pasta,Ma:tikka'],
  ['--plan', 'Ma:pasta,Do:pasta,Ma:tikka'],
  ['--plan', 'Ma:pasta,'],
  ['--plan', ',Ma:pasta'],
  ['--plan', 'Ma:pasta, Do:tikka'],
  ['--plan', 'Ma:pasta,Do:teriyaki,Di:tikka,Wo:pasta,Ma:pasta'],
  ['--plan', 'Ma:__proto__'],
  ['--plan', 'Ma:constructor'],
  ['--plan', 'Ma:pasta\nDo:pasta'],
  ['--plan', 'Ma:pasta\t'],
  ['--plan', 'Ma:pasta\u200b'],
  ['--plan', 'Ma:pasta\u0000'],
  ['--plan', '\u200bMa:pasta'],
  ['--plan', 'Ma:pasta;echo PRIVATE_TOKEN_DO_NOT_ECHO'],
  ['--plan', 'Ma:https://example.invalid/?key=PRIVATE_TOKEN_DO_NOT_ECHO'],
  ['--plan', 'Ma:pasta', '--days', 'Do'],
  ['--days', 'Ma,Ma'],
  ['--days', 'Ma, Vr'],
  ['--days', 'Vr'],
  ['--days', 'Ma:pasta'],
  ['--recipes', 'Ma:pasta'],
  ['--database', '/tmp/PRIVATE_TOKEN_DO_NOT_ECHO.sqlite'],
  ['--plan', '-Ma:pasta'],
  ['--plan', 'Ma:pasta,ma:tikka'],
  ['--plan', 'Ma:pasta,Do:pasta,Di:pasta,Wo:pasta,Zo:pasta'],
]

for (const [kind, path] of [['memory', paths[0]], ['private-SQLite', paths[1]]]) {
  test(kind + ' CLI: all 30 hostile and malformed recipe arguments fail privately with no stdout', () => {
    assert.equal(invalid.length, 30)
    for (const argv of invalid) {
      const output = spawnSync(process.execPath, ['--experimental-strip-types', path, ...argv], {
        encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024,
      })
      assert.equal(output.error, undefined, JSON.stringify(argv))
      assert.equal(output.status, 2, JSON.stringify(argv) + ': ' + output.stderr)
      assert.equal(output.stdout, '', JSON.stringify(argv))
      assert.match(output.stderr, /refused/i, JSON.stringify(argv))
      assert.doesNotMatch(output.stderr, /PRIVATE_TOKEN_DO_NOT_ECHO|https?:|example\.invalid|sourceUrl|sourceProductId|participantKey|capturedAt|priceCents|stack|at file:\/\/|\/tmp\/|\.sqlite|\.json/i, JSON.stringify(argv))
    }
  })
}
