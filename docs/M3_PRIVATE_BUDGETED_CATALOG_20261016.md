# M3 – begrensde privé-catalogusingang (16 oktober 2026)

**Status:** nieuwe zelfstandige product-core bouwsteen; bronrechten en echte veldproef blijven HOLD.

Gebruik na de zes bestaande, gecontroleerde, *historische* M1-bronadapters:

```js
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildBudgetedPrivateRetailerCatalog } from '../scripts/retailer-private-budgeted-catalog.mjs'

const batch = await loadReviewedRepositoryFixtures()
const historicalPrivateCatalog = buildBudgetedPrivateRetailerCatalog(batch)
```

De helper kopieert alle aangeleverde eigen data-descriptors voordat de gewone catalogusvalidator ze kan lezen, blokkeert Proxy's, getters, symbolen, sparse arrays en cycli en begrenst zowel **iedere afzonderlijke UTF-8-string op 1 MiB** als **alle primitieve bytes en veldnamen samen op 2 MiB**. Dat geldt ook voor niet-gebruikte metadata. De uitvoer blijft een **privé historisch beoordelingsoverzicht**, nooit een live winkelprijslijst.

De directe oorspronkelijke `buildUniversalRetailerCatalog` is hiermee **niet gerepareerd of vervangen**. Die wordt door andere productwerkers aangepast via PR's #3190/#3207/#3210. Deze zelfstandige ingang kan na afstemming in de uiteindelijke catalogusroute worden samengevoegd. Een echte fix van issue #3216 voor álle rechtstreekse API-aanroepen mag pas worden geclaimd wanneer de oorspronkelijke directe ingang dezelfde guard afdwingt en onveranderde onafhankelijke QA #3215 op dezelfde source HEAD groen draait.

Dit geeft **geen** toestemming voor winkelverzoeken, scraping, actuele prijzen, publicatie, publiceerbare besparing of M3-aftekening. Blokkades: schriftelijke PLUS/Deka-rechten #74, echte identieke 11+11 observatie binnen 24 uur #78, SHA-pinning #205 en vertrouwde permanente VPS-validator #2833. Merge pas met geverifieerde zCloud main-writer lease en toepasselijke CI.

## Nieuwe productfix: zes-adapter health weigert actieve caller-input (P1 #3236)

De bestaande publieke JavaScript-export `evaluatePrivateAdapterHealth(batch, options)`
op `scripts/retailer-private-adapter-health.mjs` gebruikt nu dezelfde
`snapshotBoundedPrivateCatalogInput`-grens **vóór** het lezen van
`batch.summary`, opgeslagen waarnemingen en `options.referenceTime`.
Ook een expliciete ongeldige `options`-structuur wordt met de vaste
Nederlandstalige domeinfout geweigerd. Er wordt geen caller-getter of Proxy-trap
aangeroepen. Gewone historische zesvormige PLUS/Deka-adaptergegevens en
geldige expliciete reviewklokken blijven werken.

De twee oorspronkelijke onafhankelijke QA-bestanden uit
[PR #3234](https://github.com/Zennay/Supa/pull/3234) zijn voor de
exacte productbroncontrole **byte-identiek** toegevoegd op onze branch:
Git-blobs `a27daba6028c139ebaccac7d183cf6008512a741` en
`33d91ac955c3e28ec6da9ea0dff09335349cdd95`.
De QA-ownerbranch is zelf niet aangepast. Deze technische
in-process inputbescherming is geen live retailer-exploit of bewijs van toestemming.

## Onafhankelijke P1-acceptatie 16 oktober: QA #3237 en #3238

- [P1 #3239](https://github.com/Zennay/Supa/issues/3239) betreft het exporteerbare health-CLI argv-pad: directe Proxy length-getters konden voor de veiligheidscontrole draaien. De eerder geplaatste product-commit a01f4b2 weigert Proxy/revoked/gespoofde argv voor invoerlezen. Originele [QA #3237](https://github.com/Zennay/Supa/pull/3237) is ongewijzigd gereplayed, byte-identieke blob f1e824abb24a15259e7135b0ef94e3adc0935cfd.
- [QA #3238](https://github.com/Zennay/Supa/pull/3238) vond nog een case-insensitive credential-query afwijking: geparste bron-URLs met ACCESS_TOKEN/Access_Token en percent-escaped spelling werden niet geweigerd door de bestaande directe catalogus. De nieuwe eigen private entrypoint weigert deze sleutels na inert kopiëren en voor het aanroepen van de gedeelde catalogus. Geen live URL-request, geen input-URL in fouttekst.
- Alle twee onafhankelijke [QA #3238](https://github.com/Zennay/Supa/pull/3238) bestandblobs zijn exact overgenomen: 71a788a6c3e4d95b3dd576666d584204fc8452ca (echte zes historische retailer-vormen en credential-variant), ceb7defc88fef6eae685cf0a35add98e3ea34c98 (exact 1/2 MiB UTF-8 budgets en 10.000-arrayrand). Eigen extra regressies testen vijf gemengde/escaped querysleutels en een normale historische metadata-query.
- De oude directe catalogus-fix blijft apart eigendom van [PR #3210](https://github.com/Zennay/Supa/pull/3210); dit is uitsluitend de additive wrapper, niet het sluiten van die bestaande P1. De definitieve CI op exacte nieuwe HEAD is nodig voordat de onafhankelijke drie originele CLI RED en één credential RED als GREEN worden gemeld.

Ongewijzigde grenzen: offline-historisch, geen bronrechten, live prijzen, externe requests, publieke besparing of automatische productiedeploy.

## Nieuwe directe health-API parity na onafhankelijke QA #3241

De onafhankelijk bevroren [QA #3241](https://github.com/Zennay/Supa/pull/3241) bewees op een eerdere product-SHA dat de **directe zes-adapter health-API** gemengde (en %-encoded) querysleutels van `access_token` nog accepteerde terwijl deze privé-catalogusingang die al weigerde. De drie oorspronkelijke ongepatchte RED-cases staan nu byte-identiek in de productbranch (Git blob `fb50837f60cb07ac64a271688661617247dcd177`).

De health-evaluator gebruikt nu intern exact dezelfde begrensde privé-catalogusfunctie voor de geaccepteerde historische capture-gegevens. Daardoor kan de directe health-ingang niet meer via de oudere, afzonderlijk beheerde universele catalogus-validator de credential-sleutelcontrole overslaan. Niets van de bron-adapters, hun andere ownerbranches of de bronrechten is aangepast. Herhaal de oorspronkelijke QA op de definitieve HEAD vóór het claimen van RED→GREEN.

Deze privacy- en invoercontrole is slechts een lokaal in-process codecontract. Er is geen echte token gecapteerd of verstuurd, er zijn geen retailwebverzoeken gedaan en dit bewijst geen toestemming om prijzen te gebruiken.
