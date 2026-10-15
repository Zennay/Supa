# SUPA — privé capture-manifest automatisch maken

De operator hoeft na een **handmatige review van reeds rechtmatig verkregen** zes PLUS/DekaMarkt-product-, catalogus- en aanbiedingen-evidencebestanden geen SHA-256-hashes meer over te typen. `scripts/retailer-private-reviewed-manifest-builder.mjs` leest alleen eerder beoordeelde JSON-bestanden, voert bestaande adapterchecks en universele productnormalisatie uit en schrijft *atomair en zonder overschrijven* een privé `manifest.json` die aansluit op de aparte private replay-engine.

## Gebruik

Plaats tussen zes en maximaal 32 **reeds gevalideerde retailer-evidencerecords** in één uitsluitend privé leesbare map, met namen zoals `capture-0.json`, `capture-1.json` of `capture-plus-catalog.json` en bestandsmodus `0600`. De map zelf moet `0700` zijn. Er moet ten minste één record zijn voor **elk** van `plus:product`, `plus:catalog`, `plus:offers`, `dekamarkt:product`, `dekamarkt:catalog` en `dekamarkt:offers`.

```sh
umask 077
node --experimental-strip-types scripts/retailer-private-reviewed-manifest-builder.mjs --dir private/reviewed-captures
# Wanneer de aanvullende onafhankelijke replay-functie op main is:
node --experimental-strip-types scripts/retailer-private-reviewed-manifest-replay.mjs --dir private/reviewed-captures
node --experimental-strip-types --test tests/product-retailer-private-reviewed-manifest-builder-20261015.test.mjs
```

De manifestgenerator maakt één bestand `manifest.json` aan, mode `0600`, met intern de bestandsnamen, eigen byte-SHA-256 van het volledige JSON-record en de zes genormaliseerde brontypen. De bestandsinhoud en identifiers worden **niet** naar stdout of logs gekopieerd; daar staan alleen aantallen en toestemming-/publicatievlaggen `false`.

Dit is geen webdownload en geen HTML-naar-productconverter. De bestaande JSON-adaptervorm moet al met browser-/SSR-evidence, sourceidentiteit, capturetijd, pack-/prijsfeiten, bron-SHA en strikte rechtenstatus zijn beoordeeld. Er vindt **geen** automatische herbeoordeling van licentievoorwaarden plaats, en er is geen proxy/browser/HTTP. Uitsluitend geautoriseerde handmatige snapshotsets horen in deze map.

Beveiligingsgrenzen: maximaal 32 bestanden van elk maximaal 1 MiB, geen symbolische of harde links, geen afwijkende bestandsnamen, exacte JSON-UTF8, geen afwijkende adaptertypes, en geen output bij afwijzing. Een bestaande `manifest.json` wordt **nooit** overschreven: de gebruiker moet dan eerst de inhoudelijke revisie en capture-identiteit onafhankelijk beoordelen en een verse privédirectory beginnen. De originele capturebron zelf blijft ongemoeid.

**M3 blijft hold:** PLUS-bronrechten `permission_required`, DekaMarkt `unresolved`, geen live crawling/actuele prijspublicatie. Schriftelijke rechten #74, menselijke 11×2 basket #78, broncode-pin #205 en permanente runner #2833 zijn onafhankelijk vereist.
