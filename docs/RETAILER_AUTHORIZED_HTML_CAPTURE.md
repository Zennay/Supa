# SUPA P1 — toestemminggestuurde, begrensde website-capture

**Implementatie:** `scripts/retailer-authorized-html-capture.mjs` op de bestaande M1-bronregistratie.

De gebruiker wil een engine die supermarktwebsites kan downloaden, waarna AI/QA de benodigde velden en selectors onderzoekt. Een volledige onbeperkte websitemirror is hiervoor niet verstandig: supermarkten hebben dynamische catalogi, promoties, verschillende HTML/SSR-structuren en mogelijke contractuele restricties. Deze capturelaag bewaart daarom **één expliciet geselecteerde, vooraf gecontroleerde publieke product-/catalogus-/aanbiedingspagina per aanroep**. Na opslag maakt `retailer-snapshot-selector-proposals.mjs` offline een SHA-gebonden reviewmanifest met mogelijke CSS-selectors en JSON-LD/Nuxt-signalen. Pas na meerdere gecontroleerde voorbeelden en expliciete acceptatie kan de bijbehorende winkeladapter worden aangepast.

## Veiligheidsregels vóór netwerktoegang

- De bestaande M1-permission gate `evidence/m1/source-permission-gate.v1.json` wordt volledig gecontroleerd. De betreffende keten moet **`permissionStatus: permitted`, `productionEnabled: true` en schriftelijk/gelicentieerd bewijs** hebben. Een ander, nog niet toegestaan filiaal of keten blijft uit.
- Alleen eigen gedocumenteerde `https://www.plus.nl` en `https://www.dekamarkt.nl` product-, catalogus- en aanbiedingenroutes. Geen querytokens, URL-credentials, privépaden of willekeurige domeinen.
- Exact één verzoek: `GET`, `credentials: omit`, `redirect: manual`, herkenbare SUPA user-agent, timeout 15 seconden, maximaal **2 MiB HTML**, expliciete HTML-contenttype. Op 403, 429, andere status, redirect of onverwachte bytes onmiddellijk stoppen. Geen proxies, login, cookies, CAPTCHA- of anti-bot-bypass.
- Een bestaand of symbolisch gelinkt outputpad wordt **vóór netwerkverkeer** geweigerd. Nieuwe opslagmap mode `0700`, HTML en manifest `0600`, inclusief bron-ID, exacte URL, UTC-tijd, SHA-256 en grootte.
- Het resultaat is nog steeds **capturebewijs**, geen gereviewde actuele prijs, legale hergebruikstoestemming buiten de daadwerkelijk gecontroleerde scope, of publieke besparingsclaim.

## Aanroepen na aantoonbaar verkregen rechten

```sh
node --experimental-strip-types scripts/retailer-authorized-html-capture.mjs \
  --source plus-product-halfvolle-melk \
  --out private-snapshots/approved-plus-run
node --experimental-strip-types scripts/retailer-snapshot-selector-proposals.mjs \
  --out private-snapshots/plus-selectors.json \
  private-snapshots/approved-plus-run
```

**Momenteel weigert de eerste opdracht terecht de bestaande repo-gate.** PLUS heeft `permission_required` en DekaMarkt `unresolved`. Wij wijzigen die status niet zonder echt toestemmingbewijs. De tests gebruiken alleen gesimuleerde positieve toestemming en een mock `fetch`, waarmee het volledige capture→selector-verkenningstraject **zonder extern verkeer** is bewezen.

## Database

De uiteindelijke canonieke laag is `schema/retailer-universal-offline.v1.sql` plus `scripts/retailer-import-universal-sqlite.py`. Daarin zijn alle ketens op dezelfde manier georganiseerd: retailer + product-ID, bron-snapshot met SHA en datum, aparte prijs-/actie-/verpakking-/beschikbaarheidswaarnemingen. Zo blijft matching schaalbaar zonder per keten aparte databasetabellen en zonder oude acties als huidige prijs te presenteren.

De parallelle [PR #2895](https://github.com/Zennay/Supa/pull/2895) blijft eigenaar van de zes specifieke parseradapters; deze capturelaag wijzigt diens code niet.

**Geen dagelijkse scheduler, uitgaande retailertraffic of uitrol zonder expliciete toestemming #74, gecontroleerde bronkwaliteit, juiste VPS-lease en releasegate.**
