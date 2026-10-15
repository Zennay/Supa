# Quality gate: exacte historische bron → SQLite-reconciliatie

Dit is een onafhankelijke **inhoudscontrole**, niet nóg een telling.
De zes al beoordeelde lokale PLUS- en DekaMarkt-bronnen bepalen de
referentiewaarheid voor de **historische, private** pilot. De controle
vergelijkt vervolgens de fysieke SQLite-rijen op dezelfde 18 eigenschappen
per waarneming, waaronder: winkel, product-ID, vastgelegde bronsoort,
originele HTTPS-bron-URL, capture-tijdstip, SHA-256, naam, prijscenten,
valuta, pakinhoud, voorraad en aanbiedingsvelden.

Daarmee kan een database niet vals 'compleet' lijken alleen doordat
er nog altijd zes snapshots en zestien waarnemingen in staan terwijl
een SHA, prijs, verpakking, beschikbaarheid of aanbod ondertussen is veranderd.

## Uitvoeren

Na een normale, lokaal gegenereerde **nieuwe privé** database:

```sh
node --experimental-strip-types scripts/retailer-build-reviewed-universal-sqlite.mjs --out /tmp/supa-private-review.sqlite
node --experimental-strip-types scripts/qa-retailer-reviewed-db-exact-parity.mjs --database /tmp/supa-private-review.sqlite
node --experimental-strip-types --test tests/qa-retailer-db-exact-fixture-parity-20261015.test.mjs
```

De tester maakt en verwijdert zijn eigen testdatabases. De tweede
CLI is alleen-lezen (SQLite `mode=ro&immutable=1`); hij vereist
een regulier, niet via symlinks bereikbaar bestand van maximaal 16 MiB,
zonder group-/other-rechten. Hij controleert de private bronmetadata
en vergelijkt **alle** fysiek bewaarde waarnemingen met de originele
bronrecords, inclusief multipliciteit, in het eigen proces.

Positieve bewijsketen: zes bronsoorten, twee ketens, zestien historische
waarnemingen met exacte inhoud. Negatieve proeven veranderen afzonderlijk
een geldige SHA, een prijs/voorraadstatus of verwijderen een observatie,
en eisen een fout zonder gedeeltelijke uitvoer. Er zijn ook veilige
pad-/symlinknegatieven.

**Geen vertrouwelijke waarden in de CLI-uitvoer:** alleen de aantallen,
`matchesOriginalFixtures`, `historicalOnly` en alle
publicatie-/productievlaggen `false`. De tijdelijke interne
Python-naar-Node-pipe bevat historische waarnemingsrijen uitsluitend
voor vergelijking; hij wordt niet gelogd, naar een endpoint verstuurd
of als artefact opgeslagen. De controle haalt niets van het internet.

## Grenzen

- Deze test attesteert de SQLite tegen de **ingebouwde historische
  fixtureversie**, niet tegen actuele winkelprijzen. Het SHA-veld
  verwijst naar de al eerder beoordeelde bronsnapshot; deze test
  downloadt of herhasht geen originele website.
- De statische pad-/symlinkinspectie is geen afdwingbare garantie tegen
  een gelijktijdige lokale rename/open-race. Gebruik uitsluitend
  lokaal beheerde, niet gelijktijdig gemuteerde privébestanden.
- Deze tool verleent geen hergebruiksrechten, activeert geen scrape,
  en maakt geen prijzen of besparingsclaims publiceerbaar.
- De externe M3-gates blijven afzonderlijk open: feitelijk 11×11
  menselijk veldbewijs (#78), toestemming (#74), broncode/SHA
  provenance (#205) en de betrouwbare VPS-workflow (#2833).

Deze QA-tool en tests veranderen geen product-core, retailer-adapters,
CI-workflows, actieve peer-PR's of productiedatabases.
