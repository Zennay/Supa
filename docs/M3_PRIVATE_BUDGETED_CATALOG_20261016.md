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
