# Safe recipe source URLs: OAuth / PKCE / SAML query refusal

`assessRecipeSourceUrl()` is a **pure, no-network preview gate**. Returning `accepted:true` never allows browser or server fetching (`fetchReady:false`). This module does not import recipes; a separate future server fetcher still needs authentication, DNS/IP and redirect pinning, TLS verification, response time/MIME/size budgets, rate limits, no credentials and explicit release review.

## Sensitive query names

`URLSearchParams` decodes percent escapes before keys are matched case-insensitively after removal of separators. The preview refuses credential-bearing query keys including ordinary access and refresh tokens **and** OAuth authorization codes (including `oauth_code` and `Auth-Code`), PKCE verifiers/challenges (`code_verifier`, mixed-case encoded names), SAML SSO assertions/requests (`SAMLResponse`, `SAMLRequest`), authorization-code and OAuth-state aliases. The function returns the fixed safe object `{accepted:false,reason:'credentialed_url'}` **without** including the original URL, query secret, or normalized URL.

Overly broad denial of harmless recipe parameters is undesirable: `?pagina=2`, `?postcode=2311` or `?productcode=A123` stay preview-eligible as long as the rest of the HTTPS hostname contract holds. The fragment is still removed and `fetchReady` stays `false`.

## Validation

```bash
node --test tests/product-recipe-source-url-auth-query-20261016.test.mjs
```

All tests use fictional local values and pure URL parsing only. Independently replay the [original unchanged QA #3273](https://github.com/Zennay/Supa/pull/3273) five source-secret REDs against this owner fix. Do not soften assertions or double-merge the original QA's test source.

This fix is a staged independent child of [product #3270](https://github.com/Zennay/Supa/pull/3270), not an edit to its owner's branch, the separately active recipe JSON-LD parser or UI. M3 still requires written retailer rights [#74](https://github.com/Zennay/Supa/issues/74), actual 11×2 human field capture [#78](https://github.com/Zennay/Supa/issues/78), code SHA [#205](https://github.com/Zennay/Supa/issues/205), permanent VPS [#2833](https://github.com/Zennay/Supa/issues/2833), scoped writer lease/review. No production import, live network fetch or price/savings claim is authorized.
