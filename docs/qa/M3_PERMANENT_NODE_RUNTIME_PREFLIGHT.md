# Supa M3: permanent VPS Node runtime smoke (QA-owned)

This is an **offline QA runtime diagnostic** for [permanent M3 runner issue #2833](https://github.com/Zennay/Supa/issues/2833). It does **not** change the workflow YAML, start a GitHub workflow, read real shop prices, establish retailer rights, or release M3.

## Confirmed local discrepancy, 17 October 2026

On the connected vps-bb300bba host, running the exact five-file M3 workflow focused test command under the **host-default Node v22.22.1** returned **9 passing and 4 failing tests**. All four failures were **ERR_NO_TYPESCRIPT: Node.js is not compiled with TypeScript support**. Under the locally available **Node v24.19.0**, those same five test files yielded **57/57 passing**. These were *local read-only executions*, **not** the actual GitHub self-hosted workflow.

**Important:** The current M3 workflow selects actions/setup-node with node-version 22. It can provision a Node 22 binary **different from the VPS default**, potentially with TypeScript support. The observed local failure does **not** establish that GitHub Actions would fail. Run this smoke using the **effective Node binary after setup-node** in the authorized same-repository, main-based workflow context.

## Reusable local offline smoke

From the Supa repository root after selecting the intended Node binary, run:

    node scripts/qa-m3-permanent-runtime-preflight-20261017.mjs --strict

This probes the exact current process.execPath through two fixed, read-only, time-bounded child imports of the observation schema and study converter. No filenames or URLs are accepted as arguments. It prints one small JSON object with only booleans and the local Node version; private file paths, child stderr, retailer inputs and customer records are never printed.

- **Exit 0:** both local TypeScript imports work. This is **not** proof that the permanent GitHub runner executed, path selectors are complete, real retailer prices exist, source rights are granted, field-run Git revision is persisted, or public savings are allowed.
- **Exit 2 with JSON:** at least one import failed; the selected Node binary cannot currently certify this M3 TypeScript runtime.
- **Exit 2 with generic stderr:** invalid CLI arguments or unexpected runtime setup.

If the actual setup-node binary fails, the owner of [workflow PR #2604](https://github.com/Zennay/Supa/pull/2604) must choose a verified compatible Node runtime and rerun this smoke **after setup-node**. Retain all existing same-repo fork exclusion, main-base and main-only dispatch restrictions, pinned actions, approved hostname, bounded timeout, and private artifact controls. Then run the focused M3 suite, full native tests and build.

## Other independent blocker

[QA PR #3887](https://github.com/Zennay/Supa/pull/3887) creates a reproducible conservative inventory of missing permanent M3 pull-request triggers and seven **owner-review-only** narrowly scoped candidate selectors. A working Node binary **cannot** fix missing triggers; correct path triggers **cannot** fix an incompatible Node runtime.

**M3 remains ACTIVE/HOLD** until written retailer rights (#74), fresh genuine 11×2 paired human observations (#78), product-persisted current-main Git SHA (#205), and verified permanent self-hosted M3 workflow execution (#2833) are actually satisfied.
