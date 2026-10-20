# SUPA M3 — independent documentary source-rights QA (17 October 2026)

## Purpose

An **operator-side, offline** QA check for the actual repository rights registry, independent of the product source-permission gate. This is a deliberately conservative backstop for [source evidence URL issue #3782](https://github.com/Zennay/Supa/issues/3782), **not** its product-code repair and **not** contractual evidence that any retailer granted permission.

The present official register says **PLUS `permission_required`**, **DekaMarkt `unresolved`**, with `productionReady:false`. Even if some future JSON entry claims `written_permission`, the checker never equates the presence of a URL with a verified legal agreement. A human must independently authenticate the authorizing entity, scope, licence, limitations and validity.

## Runbook

From the checked-out SUPA repository with Node and dependencies available:

```sh
node scripts/qa-m3-documentary-rights-audit-20261017.mjs
node scripts/qa-m3-documentary-rights-audit-20261017.mjs --require-release
node --test tests/qa-m3-documentary-rights-audit-20261017-w1.test.mjs
```

- The normal audit returns **exit 0** when the canonical reviewed registry remains safely blocked and emits a JSON aggregate with `releaseDecision:"hold"`. **Exit 0 here means the audit ran, not that production is authorized.**
- The second, **strict release assertion**, must return **exit 2** while human approval and real M3 field evidence remain unproven. It still emits a safe JSON HOLD decision. A CI job may use that exit condition as a negative-release test but must not misreport it as a failing operational system.
- Invalid CLI switches, dangerous documentary URL syntax and a self-asserted `productionReady:true` cannot produce independent release approval.
- Only `evidence/m1/source-permission-gate.v1.json` is read. **No `--file`, `--url`, network, DNS, scraper, password, cookie, participant, offers or product-price input is available.** URLs and evidence text are never emitted to stdout/stderr, only aggregate counts.

## Trust boundaries and limitations

The static URL check blocks literal IP hosts (even globally routable ones), localhost, local/internal domains, fragments, URL userinfo, nonstandard ports and obvious credential-query keys. It does **not** fetch documents, resolve DNS, follow redirects or verify the author of an uploaded document; a benign-looking HTTPS hostname can still host false content or resolve to a private address. Those remain **human/owner verification responsibilities**.

This QA tool intentionally does not edit the canonical source registry or existing production permission engine. [QA test-only expected-RED PR #3781](https://github.com/Zennay/Supa/pull/3781) separately documents original product-gate acceptance of nonpublic documentary links; the exclusive owner must fix that boundary and run the immutable RED→GREEN tests. The standalone QA backstop is additional defense, not a substitution.

**M3 release remains on HOLD** independently for [retailer permission #74](https://github.com/Zennay/Supa/issues/74), [genuine same-context PLUS/DekaMarkt 11×2 field evidence #78](https://github.com/Zennay/Supa/issues/78), [true field-run commit pin #205](https://github.com/Zennay/Supa/issues/205) and [trusted runner #2833](https://github.com/Zennay/Supa/issues/2833). Historical/offline fixture tests cannot provide current prices or publicly claimable savings.
