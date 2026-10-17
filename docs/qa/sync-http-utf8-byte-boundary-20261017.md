# SUPA device sync — native UTF-8 trust-boundary QA (17 Oct 2026)

**QA-only, NOT a repaired product API.** This note accompanies [DRAFT PR #3789](https://github.com/Zennay/Supa/pull/3789), whose two new independent test files are pinned on the active product owner [DRAFT #3777](https://github.com/Zennay/Supa/pull/3777) SHA `1e8d5e06bcdc84be749d02b12a4183bbb77eb259`. None of these tests use real participant IDs, retailer prices, external HTTP, credentials, synced customer data or savings claims.

## Independently reproduced inputs and outputs

The product `server/app.mjs::readBody` currently performs `body += chunk` for each HTTP data Buffer. UTF-8 is a stream encoding: one valid code point can be divided across two Buffers. Decoding each Buffer separately replaces split bytes with Unicode U+FFFD and can still form valid JSON, so `/api/sync` responds 200 and stores altered private shopping progress.

First original test suite: [CI #39015963328](https://github.com/Zennay/Supa/actions/runs/39015963328), native checkout of commit `ec55524fd9927220ec0aa9a8120361587882f6d1` onto frozen #3777, **3243/3246 Node PASS and exactly 3 intended RED**; normal single-buffer shopping UTF-8 control GREEN. Concrete persisted corruptions: `Café` → `Caf��`, `€uro-fixture` → `���uro-fixture`, and `Test 🍱 basket` → `Test ���� basket`. These are synthetic local fixtures, not real buyers or visits.

Second add-only independent suite: [CI #39016236725](https://github.com/Zennay/Supa/actions/runs/39016236725), checkout of commit `3701798b9c37d8ac7bae37b5f06cc85399b0e42c`, **3243/3250 Node PASS, seven intentional RED**: the same three split-character cases plus four malformed-UTF-8 cases incorrectly admitted instead of rejected (`0x80`, `0xFF`, overlong `C0 AF`, surrogate `ED A0 80`). Both native logs have been inspected fully and contain no unrelated failures/skips/cancelled/todo. npm ci/high-audit succeeded; **matching, actual denied source-permission gate and TS/Vite build did not run** after the intentional Node failures.

## Exclusive product-owner acceptance contract

The requested fix belongs to the existing `server/app.mjs` owner, not QA worker 1/2. Read incoming HTTP Buffers as **bytes** with a genuine maximum **byte** budget, and either combine the bounded Buffers then `new TextDecoder('utf-8', { fatal:true }).decode(bytes)`, or decode incrementally with a stateful strict UTF-8 decoder. Do not concatenate independently decoded Buffer strings, do not silently substitute U+FFFD for malformed wire bytes, and do not leak private shopping text in API errors. For invalid encoding return a generic 400/422 and leave the device revision/storage unchanged. For all valid split code points return 200 with **exactly preserved** original decoded shopping data. Preserve existing recipe-import, body-size, rate-limit, same-origin, auth and local-only privacy behavior.

For final product-owner review, run both **original QA files byte-identically** on the exact repaired owner SHA and require every one of the seven targeted tests GREEN alongside the existing suite, `npm ci`, `npm audit --audit-level=high`, matching benchmark, **actual** source-permission gate remaining `productionReady:false`, and TypeScript/Vite build. If a new head is pushed, revalidate exact-head; never carry a prior GREEN or expected RED across changed source without evidence.

## Scope and release gates

Separate [issue #3791](https://github.com/Zennay/Supa/issues/3791) and [Notion work item](https://app.notion.com/p/3fc9e19ac955813ea082de7d8e7a8aca) track the owner remediation. Both this test PR and the product PR stay **DRAFT/NONMERGE** unless genuinely authorized scoped writer and protected-main merger leases are obtained. M3 completion is independently held by written PLUS/Deka retailer rights [#74](https://github.com/Zennay/Supa/issues/74), genuine same-demand human 11×2 observations [#78](https://github.com/Zennay/Supa/issues/78), field source SHA [#205](https://github.com/Zennay/Supa/issues/205), and permanent runner [#2833](https://github.com/Zennay/Supa/issues/2833).

**No live retailer capture, customer-sync data, verified price or public savings evidence was used or produced.**
