import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// Synthetic argument-only probes. The deliberately nonexistent input is never read
// because malformed output destinations must fail before file/report I/O.
const commands = [
  'scripts/m3-build-observed-study.mjs',
  'scripts/m3-assess-observed-week.mjs',
]
const input = 'qa-nonexistent-synthetic-input.json'

function invoke(script, rest) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', script, input, ...rest,
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 })
  assert.ifError(result.error)
  return result
}

for (const script of commands) {
  for (const [name, args, diagnostic] of [
    ['missing destination', ['--output'], /--output requires exactly one non-option destination path/u],
    ['option-like destination', ['--output', '--private'], /--output requires exactly one non-option destination path/u],
    ['empty destination', ['--output', ''], /--output requires exactly one non-option destination path/u],
    ['whitespace destination', ['--output', ' report.json '], /--output requires exactly one non-option destination path/u],
    ['duplicate destinations', ['--output', 'first.json', '--output', 'second.json'], /--output may be specified only once/u],
  ]) {
    test(`M3 ${script}: ${name} fails before private input/output I/O`, () => {
      const run = invoke(script, args)
      assert.notEqual(run.status, 0)
      assert.equal(run.stdout, '', 'never print a derived report or field JSON')
      assert.match(run.stderr, diagnostic)
      assert.doesNotMatch(run.stderr, /could not be read\/parsed/u, 'must reject before input read')
      assert.doesNotMatch(run.stderr, /synthetic-input\.json/u, 'no input path in diagnostic')
    })
  }
}
