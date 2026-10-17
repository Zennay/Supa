# SUPA M3 — onafhankelijke offline documentenrechten-audit

De lokale rechten-audit `scripts/qa-m3-documentary-rights-audit-20261017.mjs` controleert alleen de **vorm van documentaire HTTPS-bronverwijzingen** in `evidence/m1/source-permission-gate.v1.json`. Dit is **geen bewijs van een geldig contract, toestemming of licentie**. Het resultaat blijft altijd `productionReady:false`, `releaseDecision:"hold"` en `publicSavingsClaimEligible:false`.

## Extra controle van credential-namen

Een HTTPS-link kan een privégeheim in zijn queryparameternaam verbergen met meerdere URL-encoderingslagen. WHATWG `URLSearchParams` decodeert maar één laag en zou anders bijvoorbeeld `?ACCESS%255fTOKEN=...` nog als een gewone, onschuldige verwijzing classificeren. De onafhankelijke QA-audit controleert daarom query**namen** met beperkte herhaalde decodeerlagen en conservatieve Unicode NFKC-normalisatie. Hij weigert ook dubbelzinnige percent-escapes, zichtbare en onzichtbare Unicode-varianten van credential-namen en lege afsluitende `?`/`#`-scheidingstekens.

Voorbeelden van geweigerde **synthetische** parameterfamilies: OAuth access/refresh-tokens, PKCE `code_verifier`, `client_secret`, SAML-responses, sessie-ID's, JWT en camelCase `authToken`. Gewone `?locale=nl&revision=2026`-documentatieverwijzingen blijven syntactisch mogelijk.

Deze controle voert **nooit HTTP, DNS-resolutie of een rechtenmutatie uit**; hij geeft geen URL of waarde terug, alleen aantallen en booleans. Een vertrouwd-ogende host kan naar een intern adres wijzen of later redirecten: zonder DNS/redirect-onderzoek en menselijke juridische beoordeling blijft er uitdrukkelijk **geen** onafhankelijke rechtenvaststelling.

## Bedieningspad

```sh
node scripts/qa-m3-documentary-rights-audit-20261017.mjs
node scripts/qa-m3-documentary-rights-audit-20261017.mjs --require-release
```

De normale inspectie rapporteert privaat de huidige HOLD met exitcode 0 als de audit zelf veilig kan worden uitgevoerd. De strikte releasecontrole eindigt altijd met niet-nul exitcode. Geen van beide activeert scraping, live prijsfeeds of publieke besparingsclaims.

## Regressies

```sh
node --experimental-strip-types --test tests/qa-m3-documentary-rights-*.test.mjs
```

Alle nieuwe gevallen zijn lokaal en fictief. **Dit repareert niet automatisch de product-owned bronrechtengate** `scripts/m1-check-source-permission-gate.mjs`; issue [#3782](https://github.com/Zennay/Supa/issues/3782) blijft open totdat diens eigenaar de productiebroncontrole met eigen tests en rechtenbesluit heeft afgerond. De echte PLUS/DekaMarkt-toestemming [#74](https://github.com/Zennay/Supa/issues/74) en same-window 11×2 veldmeting [#78](https://github.com/Zennay/Supa/issues/78) zijn evenmin geleverd.
