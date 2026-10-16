import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(new URL('../.github/workflows/m1-data-capture.yml', import.meta.url), 'utf8')

test('legacy M1 capture transport step is exclusively manually dispatched on protected main, never a pull request', () => {
  assert.match(workflow,
    /- name: Capture representative public pages\n[\s\S]*?if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\n\s*id: capture/)
  assert.match(workflow,
    /- name: Capture representative public pages[\s\S]*?run: node scripts\/m1-capture-sources\.mjs/)
})

test('changing canonical source rights or its validator retriggers the permanent M1 workflow contract checks', () => {
  assert.match(workflow, /^\s+- "scripts\/m1-check-source-permission-gate\.mjs"$/m)
  assert.match(workflow, /^\s+- "evidence\/m1\/source-permission-gate\.v1\.json"$/m)
})

test('M1 does not silently authorize retailer HTTP from fork or same-repository PR synthetic code', () => {
  assert.match(workflow, /persist-credentials:\s*false/)
  assert.match(workflow, /runs-on:\s*self-hosted/)
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.equal(workflow.includes('if: github.event_name == \'pull_request\' && github.ref == \'refs/heads/main\''), false)
})
