# SUPA — echte gecontroleerde offline adapter-replay uit lokaal bronarchief

`scripts/retailer-private-reviewed-manifest-replay.mjs` verwerkt **nieuwe, al handmatig beoordeelde en lokaal opgeslagen** PLUS/DekaMarkt-evidencerecords via de bestaande zes product-, catalogus- en aanbiedingenadapters, daarna door de universele catalogus en de historische gezondheidscontrole. Anders dan het vaste M1-demo-commando leest dit de geselecteerde operator-map, maar **nooit** een netwerk-URL.

## Een operator-directory voorbereiden

Maak een privémap met daarin `manifest.json` plus de bijbehorende maximaal 32 `*.json`-evidencebestanden, allemaal gewone bestanden in de **zelfde map** en mode `0600`. Voor elk record moet de JSON-inhoud al de bestaande, formeel beoordeelde adaptervorm bevatten (inclusief browser-/SSR-evidence, eigen capture-SHA en provenance). Een HTML-download of een ongetoetst productbestand is hier **niet** automatisch adapterbewijs.

```json
{
  "schemaVersion": 1,
  "mode": "private-reviewed-retailer-batch",
  "productionEnabled": false,
  "permissionVerified": false,
  "publicSavingsClaimEligible": false,
  "sources": [
    { "file": "plus-reviewed-product.json", "sha256": "<64 lowercase hex of complete JSON file bytes>", "key": "plus:product" },
    { "file": "plus-reviewed-catalog.json", "sha256": "<64 lowercase hex of complete JSON file bytes>", "key": "plus:catalog" },
    { "file": "plus-reviewed-offers.json", "sha256": "<64 lowercase hex of complete JSON file bytes>", "key": "plus:offers" },
    { "file": "deka-reviewed-product.json", "sha256": "<64 lowercase hex of complete JSON file bytes>", "key": "dekamarkt:product" },
    { "file": "deka-reviewed-catalog.json", "sha256": "<64 lowercase hex of complete JSON file bytes>", "key": "dekamarkt:catalog" },
    { "file": "deka-reviewed-offers.json", "sha256": "<64 lowercase hex of complete JSON file bytes>", "key": "dekamarkt:offers" }
  ]
}
```

Vervang de voorbeeldwaarden met de werkelijke bestands-SHA's van *reeds gecontroleerde* privébronnen. Exact een volledig schema is verplicht; dezelfde winkelvorm mag maximaal 32 bronbestanden in het totaal omvatten, met unieke bestandsnamen en capture-identiteiten. Genereer SHA-256 lokaal over de daadwerkelijke bestandsbytes; de bron-SHA **van de HTML in het bewijsrecord** is een andere integriteitslaag. Niet mengen.

```sh
umask 077
node --experimental-strip-types scripts/retailer-private-reviewed-manifest-replay.mjs --dir private/reviewed-retailer-captures
node --experimental-strip-types --test tests/product-retailer-private-reviewed-manifest-replay-20261015.test.mjs
```

De ingestie weigert missende vormen, symlinks, hardlinks, los toegankelijke evidence, afwijkende bestanden, ongeldige UTF-8, foutieve SHA-256, buitenmappaden, ongoedgekeurde adaptertypen en onverenigbare product-/bronrechtenclaims. Een fout leidt niet tot stdout-output. Er worden maximaal 32 JSON-bronnen (elk maximaal 1 MiB) geanalyseerd, met een maximale manifestgrootte van 64 KiB. Het resultaat is **uitsluitend geaggregeerd**, bevat geen prijs, artikelnaam, identificeerbare SKU, URL, bestandsnaam of SHA en schrijft niets naar een publieke winkelcatalogus.

## Reikwijdte en rechten

Deze replay is een echte uitvoerbare **offline ingestie** van reeds beoordeelde brondata, géén volledig zelfstandige scraper. Nieuwe ruwe HTML moet eerst rechtmatig worden verkregen, als capture worden gepind en door de juiste retaileradapters/menselijke review zijn gegaan. De huidige rechtenpoort: PLUS `permission_required`, DekaMarkt `unresolved`. **Geen** toestemming om daarmee het web live op te halen; geen proxy-, CAPTCHA- of private-API-bypass. Prijs/aanbiedingen kunnen historische interne feiten zijn, maar zijn niet betrouwbaar genoeg voor een publieke besparingsclaim. M3 #74/#78/#205/#2833 blijven afzonderlijke externe releaseholds.
