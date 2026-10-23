import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  buildM3TriggerOwnerPatchPreview,
  main,
} from '../scripts/qa-m3-permanent-trigger-owner-patch-preview-20261017.mjs'
import {
  collectM3TriggerCandidates,
  auditM3TriggerClosure,
  extractM3PullRequestPaths,
  selectorCoversM3File,
} from '../scripts/qa-m3-permanent-runner-trigger-inventory-20261017.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const YAML = '.github/workflows/m3-observed-week-report.yml'
const WORKFLOW = await readFile(resolve(ROOT, YAML), 'utf8')
const INVENTORY = await collectM3TriggerCandidates(ROOT)
const CLI = fileURLToPath(new URL('../scripts/qa-m3-permanent-trigger-owner-patch-preview-20261017.mjs', import.meta.url))
const run = args => spawnSync(process.execPath,
  ['--experimental-strip-types', CLI, ...args], { encoding: 'utf8', timeout: 10000 })
const checked = () => buildM3TriggerOwnerPatchPreview(WORKFLOW, INVENTORY)

describe('P1 #2833 — real M3 persistent VPS workflow owner patch proposal', () => {
  it('proposes a compact, scoped, coverage-complete patch to actual checked-out source tree, without writing it', async () => {
    const original = await readFile(resolve(ROOT, YAML))
    const result = checked()
    assert.equal(result.schemaVersion, 1)
    assert.equal(result.mode, 'independent-m3-self-hosted-trigger-owner-patch-preview')
    assert.equal(result.workflow, YAML)
    assert.ok(result.uncoveredBefore > 10)
    assert.ok(result.proposedAdditionalSelectors.length >= 5)
    assert.ok(result.proposedAdditionalSelectors.length < 20)
    assert.equal(result.simulatedUncoveredAfter, 0)
    assert.equal(result.simulatedPathCoverageComplete, true)
    assert.equal(result.realWorkflowCoverageComplete, false)
    assert.equal(result.actualWorkflowChanged, false)
    assert.equal(result.sourceOwnerMustApproveAndApply, true)
    assert.equal(result.selfHostedRunnerExecutedAndAttested, false)
    assert.equal(result.productionReady, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.releaseDecision, 'hold')
    assert.deepEqual(await readFile(resolve(ROOT, YAML)), original)
  })

  it('each proposed selector covers actually missing files only in reviewed M3 namespaces or explicitly admitted dependency', () => {
    const before = auditM3TriggerClosure(WORKFLOW, INVENTORY)
    const proposed = checked().proposedAdditionalSelectors
    const allow = new Set([
      'scripts/m3-*.mjs', 'scripts/qa-m3-*.mjs',
      'tests/m3-*.test.mjs', 'tests/qa-m3-*.test.mjs',
      'tests/product-m3-*.test.mjs',
    ])
    const paths = new Set(INVENTORY.map(x => x.path))
    for (const candidate of proposed) {
      assert.ok(allow.has(candidate) || paths.has(candidate))
      assert.ok(before.missingPaths.some(path => selectorCoversM3File(path, candidate)))
      for (const untrusted of ['tests/foreign.test.mjs', 'scripts/random.js',
        '.github/workflows/other.yml', 'src/unknown/random.ts']) {
        assert.equal(selectorCoversM3File(untrusted, candidate), false, candidate)
      }
    }
    assert.equal(new Set(proposed).size, proposed.length)
    assert.ok(!proposed.includes('tests/**'))
    assert.ok(!proposed.includes('scripts/**'))
  })

  it('literal YAML additions create 100% narrowly scoped coverage in memory, preserving all live runner job policies', () => {
    const before = checked()
    const patch = before.proposedSelectorYamlLines.join('\n') + '\n'
    const copy = WORKFLOW.replace('  workflow_dispatch:', patch + '  workflow_dispatch:')
    const a = auditM3TriggerClosure(copy, INVENTORY)
    assert.equal(a.missingPathCount, 0)
    assert.equal(a.pathCoverageComplete, true)
    assert.ok(copy.includes('    runs-on: self-hosted'))
    assert.ok(copy.includes('      node-version: 22'))
    assert.ok(copy.includes('  cancel-in-progress: true'))
    assert.ok(copy.includes("if: (github.event_name == 'workflow_dispatch'"))
    assert.equal(a.selfHostedRunnerExecutedAndAttested, false)
    assert.equal(a.productionReady, false)
    assert.equal(a.publicSavingsClaimEligible, false)
    assert.equal(a.m3ExitProven, false)
    assert.deepEqual(extractM3PullRequestPaths(copy).slice(0, before.originalPathCount),
      extractM3PullRequestPaths(WORKFLOW))
  })

  it('every proposed path group contributes real missing coverage; removing one restores incomplete state', () => {
    const before = checked()
    const patched = WORKFLOW.replace('  workflow_dispatch:',
      before.proposedSelectorYamlLines.join('\n') + '\n  workflow_dispatch:')
    for (const line of before.proposedSelectorYamlLines) {
      const partial = patched.replace(line + '\n', '')
      const audit = auditM3TriggerClosure(partial, INVENTORY)
      assert.ok(audit.missingPathCount >= 1, line)
      assert.equal(audit.pathCoverageComplete, false)
      assert.equal(audit.productionReady, false)
    }
  })

  it('readable CLI prints only validated owner selector candidates; never modifies workflow', () => {
    const output = run(['--selectors'])
    assert.equal(output.error, undefined)
    assert.equal(output.status, 0, output.stderr)
    assert.match(output.stdout, /OWNER REVIEW ONLY/)
    assert.ok(output.stdout.includes('scripts/qa-m3-*.mjs'))
    assert.ok(output.stdout.includes('tests/qa-m3-*.test.mjs'))
    assert.equal(output.stderr, '')
    assert.equal(output.stdout.includes('participantKey'), false)
    assert.equal(output.stdout.includes('currentPriceCents'), false)
    assert.equal(output.stdout.includes('password='), false)
  })

  it('real CLI status is HOLD and strict require-real-coverage exits 2 despite perfect simulated patch', () => {
    const ordinary = run([])
    assert.equal(ordinary.error, undefined)
    assert.equal(ordinary.status, 0, ordinary.stderr)
    const report = JSON.parse(ordinary.stdout)
    assert.deepEqual(report, checked())
    assert.equal(report.productionReady, false)
    const strict = run(['--require-real-coverage'])
    assert.equal(strict.status, 2, strict.stderr)
    assert.equal(JSON.parse(strict.stdout).realWorkflowCoverageComplete, false)
    assert.equal(JSON.parse(strict.stdout).simulatedPathCoverageComplete, true)
  })

  it('malformed or spoofed YAML and arbitrary inventory additions cannot launder unreviewed triggers', () => {
    for (const mutate of [
      v => v.replace('  pull_request:', '  other_event:'),
      v => v.replace('      - "' + YAML + '"\n',
        '      - "' + YAML + '"\n      - "tests/**"\n'),
      v => v.replace('  workflow_dispatch:', '  workflow_dispatch:\n  workflow_dispatch:'),
    ]) {
      assert.throws(() => buildM3TriggerOwnerPatchPreview(mutate(WORKFLOW), INVENTORY),
        /Independent M3 trigger owner patch preview refused/)
    }
    const bad = [...INVENTORY, { group: 'bad', path: 'tests/unowned-random.test.mjs' }]
    assert.throws(() => buildM3TriggerOwnerPatchPreview(WORKFLOW, bad),
      /Independent M3 trigger owner patch preview refused/)
  })

  it('hostile programmatic argv never invokes getters or Proxy traps, and public/unsafe CLI options are rejected', async () => {
    let touched = 0
    const args = ['--selectors']
    Object.defineProperty(args, '0', {
      enumerable: true, get() { touched++; throw Error('CANARY') },
    })
    for (const input of [
      args, new Proxy([], { get() { touched++; throw Error('CANARY') } }),
      ['--publish'], ['--force'], ['--selectors','--write-yaml'],
      Object.assign([], { extra: true }),
      Object.setPrototypeOf([], null),
    ]) {
      let output = ''
      await assert.rejects(main(input, x => { output += x }),
        /Independent M3 trigger owner patch preview refused/)
      assert.equal(output, '')
    }
    assert.equal(touched, 0)
  })
})
