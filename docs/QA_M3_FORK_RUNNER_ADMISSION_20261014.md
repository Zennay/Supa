# Independent M3 permanent-runner fork admission audit — 2026-10-14

## Scope and ownership

- Existing security issue: https://github.com/Zennay/Supa/issues/365
- Frozen original M3 source owner: https://github.com/Zennay/Supa/pull/191 at `68bcae4d810a1f3d446c9762dc8361a87e08dd37`.
- This QA branch changes **only** a new test and this note. The original workflow, product code, live evidence and permanent VPS are not changed.
- The original owner must address the workflow defect on their own branch. Do not merge or dispatch any permanent self-hosted validation from this branch while the original source remains vulnerable.

## Finding

The M3 observed-week workflow is a `pull_request`-triggered workflow with a `runs-on: self-hosted` job executing `npm ci` and repository tests. It currently has no job-level same-repository PR head admission guard. Read-only token permissions and an in-job hostname check do not prevent assigning that permanent runner to untrusted fork PR code. The workflow must not schedule fork code on `vps-bb300bba`.

## Isolated QA contract

`tests/qa-m3-fork-runner-admission-20261014.test.mjs` has eight synthetic, self-contained admission controls plus one actual-source assertion. Safe controls accept the documented job guard (including harmless comments). Unsafe controls reject a missing guard, step-level-only guard, guard for another job, late guard, repository-owner substitution, and always-true bypass. The real source test is expected to fail until the existing M3 workflow owner implements the same-repo fork restriction before `runs-on`.

Run the focused suite on GitHub-hosted compute only:

```sh
node --test tests/qa-m3-fork-runner-admission-20261014.test.mjs
```

Expected on frozen source: eight synthetic controls PASS and exactly one *intended source* RED. Do not describe the full suite or downstream build as green when the guard is absent. Once the workflow owner fixes the source, re-run the original *unchanged* test to GREEN on a separately frozen corrected owner snapshot.

## Release / evidence boundary

This is static workflow admission acceptance only. No fork PR code was executed, no actual runner compromise observed, no real retailer request, observed supermarket price, participant or savings result produced. The human M3 exit requirement remains issue #78: genuine same-demand 11-line PLUS and DekaMarkt observation within 24 hours. DRAFT / HOLD / NO MERGE / NO DEPLOY until independent zCloud scope/lease and original owners' security, integration and release gates are met.
