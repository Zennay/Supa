# M3 permanent self-hosted PR trigger — executable owner patch preview

This is an actionable **QA-only** tool for open **P1 #2833**. It reads the actual `.github/workflows/m3-observed-week-report.yml` together with all **currently present** M3 scripts, M3 tests and explicit critical dependencies. Using the existing independent path inventory, it calculates **exactly which selectors the workflow owner can add** to cover the omissions. It NEVER writes YAML, pushes a PR over the CI owner's branch, enables forking untrusted workflow code or executes the self-hosted runner.

## Run the exact checked-out branch

```sh
node scripts/qa-m3-permanent-trigger-owner-patch-preview-20261017.mjs
node scripts/qa-m3-permanent-trigger-owner-patch-preview-20261017.mjs --selectors
node scripts/qa-m3-permanent-trigger-owner-patch-preview-20261017.mjs --require-real-coverage
```

- Default prints an aggregate-only JSON report: candidates examined; missing path count now; the proposed seven scoped selectors; in-memory projected coverage; **unchanged actual workflow**; explicit `releaseDecision:"hold"`.
- `--selectors` prints an **owner-review-only YAML snippet** to insert *under* `on.pull_request.paths` **after independent CI ownership and security review**. It does not overwrite or create the workflow.
- `--require-real-coverage` deliberately returns exit 2 until the **actual checked-out workflow** has coverage. Even a 100%-complete in-memory patch can never make this check pass.

## Seven current proposed selectors

```yaml
      - "scripts/m3-*.mjs"
      - "scripts/qa-m3-*.mjs"
      - "tests/m3-*.test.mjs"
      - "tests/qa-m3-*.test.mjs"
      - "tests/product-m3-*.test.mjs"
      - "evidence/m1/source-permission-gate.v1.json"
      - "scripts/m1-check-source-permission-gate.mjs"
```

The real workflow's existing selectors, job steps, `runs-on: self-hosted`, `github.repository` same-repository PR check, `github.base_ref == main`, workflow_dispatch restrictions, read-only contents permissions and all other guards are unchanged in the proposed in-memory copy. Re-run this tool on current `main`; inventory counts can grow as new M3 files land. A broad `tests/**` or `scripts/**` trigger is explicitly **not** equivalent to safe M3 path closure.

### Still necessary before real M3 permanent VPS proof

1. Workflow owner reviews and applies only approved scoped paths. The tool checks that every line repairs at least one actual missing path and that the full *simulated* inventory becomes covered.
2. Independently fix/check the permanent runner Node/TypeScript runtime. The present workflow pins Node22; on one connected VPS `/usr/bin/node` Node22 accepted `--experimental-strip-types` but failed with `ERR_NO_TYPESCRIPT`. Existing owner [draft PR #3889](https://github.com/Zennay/Supa/pull/3889) addresses preflight. This QA proposal does not take over or silently change that owner's runtime.
3. Verify a **real authorized GitHub Actions self-hosted job** on `vps-bb300bba`, checkout SHA, complete test/build, and immutable original logs. A local simulation or ordinary GitHub hosted CI is **not an attestation**.
4. M3 external source rights [#74](https://github.com/Zennay/Supa/issues/74), genuine same-context paired 11×2 user observations [#78](https://github.com/Zennay/Supa/issues/78), and physical field-run SHA [#205](https://github.com/Zennay/Supa/issues/205) are independent blockers.

The resulting QA report always states `selfHostedRunnerExecutedAndAttested:false`, `productionReady:false` and `publicSavingsClaimEligible:false`. The workflow owner can cherry-pick the **proposal**, but must not treat this dry-run as a product release or a permission grant.

## Automated acceptance

```sh
node --experimental-strip-types --test tests/qa-m3-permanent-trigger-owner-patch-preview-20261017.test.mjs
```

Tests use the real currently tracked owner YAML + live source-tree inventory, prove every proposed selector adds real missing coverage, that deleting each selector reintroduces a gap, that no broad/unreviewed path or attacker-injected inventory entry is trusted, that malicious argv getters and Proxy traps do not execute, and that the real workflow bytes remain unchanged. Output contains no private store or participant data.
