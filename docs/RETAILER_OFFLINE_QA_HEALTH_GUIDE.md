# Supa — controleer supermarktdata zonder live scraping

Deze werkinstructie hoort bij de onafhankelijke quality-validation-tools voor de
**private historische** PLUS- en DekaMarkt-pilot. Hij beschrijft wat uitvoerbaar
is, en vooral wat níét als actuele of toegestane prijs mag worden uitgelegd.

## Kortste veilige route: één opdracht

De aanbevolen QA-run voor de zes lokale, reeds beoordeelde historische bronnen is:

```sh
node --experimental-strip-types scripts/qa-retailer-offline-quality-bundle.mjs \
  --as-of 2026-10-15T00:00:00Z
```

Deze opdracht bouwt zelf een tijdelijke private SQLite-database, draait
de strikte zes-bronnen-preflight, voert het historische kwaliteitsrapport uit,
controleert dat de drie onafhankelijke aantallen overeenkomen en ruimt de
tijdelijke database altijd op. Hij geeft **één anoniem JSON-resultaat** met
per-winkel kwaliteitstellers, zonder prijzen, URLs, productnamen of PII. Er
wordt geen bestand in de huidige map aangemaakt, en er gaat geen supermarkt-
HTTP-verzoek uit. Verouderde captures blijven `stale`, nooit 'actueel'.

De losse stappen hieronder blijven nuttig om een bestaande private database
zelfstandig te auditen; zij hebben dezelfde beperkingen voor rechten en M3.

## Eén offline bronketen, drie controles

Vanaf de repositoryroot met de gepinde Node- en Python 3-versies:

```sh
node --experimental-strip-types scripts/retailer-build-reviewed-universal-sqlite.mjs \
  --out private-retailer-review.db
python3 scripts/qa-retailer-sqlite-six-kind-preflight.py \
  --database private-retailer-review.db
python3 scripts/qa-retailer-sqlite-health-report.py \
  --database private-retailer-review.db --as-of 2026-10-15T00:00:00Z
```

De eerste stap leest **alleen zes meegeleverde, al beoordeelde lokale M1-captures**:
PLUS en DekaMarkt met ieder `product`, `catalog` en `offers`. Hij bouwt een
nieuwe SQLite-database met rechten `0600`; de gebruiker kiest zelf de locatie.
Die database wordt niet overschreven. **Bewaar hem niet in Git en deel hem niet
publiek.** Verwijder het lokale bestand na de kwaliteitscontrole wanneer het
niet langer nodig is.

De tweede stap is een strenge toelatingscheck. Hij eist twee daadwerkelijk
gevulde retailerpartities, drie brontypen per winkel, werkelijke gekoppelde
waarnemingen, passende originele bronhashes, HTTPS-bronhosts, geldige capture-
tijd, private status en ontbreken van productie-/publicatierechten. Hij controleert
dus ook of de tabellen elkaar niet alleen administratief, maar werkelijk dekken.
Bij onvolledigheid of twijfel: **exitcode 2 en geen gedeeltelijke JSON-uitvoer**.

De derde stap bouwt verder op *dezelfde* toelatingscheck en geeft uitsluitend
geaggregeerde kwaliteitsinformatie: aantal broncaptures, unieke producten,
historische waarnemingen en per winkel hoeveel metingen ouder dan 24 uur zijn,
hoeveel prijzen onbekend zijn, beschikbaarheid onbekend is, verpakking onzeker
is of een historische aanbiedingwaarde aanwezig is. Geen bedragen, productnamen,
deelnemers, cookies, URL's of afzonderlijke source hashes worden getoond.

## Het resultaat juist interpreteren

De bestaande gecontroleerde pilot omvat **6 brontypen, 6 historische snapshots,
13 retailereigen producten en 16 waarnemingen**. Bij beoordeling op
`2026-10-15T00:00:00Z` zijn alle zes captures ouder dan 24 uur. Dit is bewust
**geen** fout die wordt weg-gecorrigeerd: de bronnen blijven historisch.
`--as-of` is een expliciet review-klokmoment, geen nieuw capture-moment en
geen bewijs dat een retailer zijn prijzen sindsdien niet heeft gewijzigd.

`historicalOnly:true`, `trustedCurrentPrices:false`,
`productionEnabled:false` en `publicSavingsClaimEligible:false` mogen
niet worden weggefilterd of als 'tijdelijke waarschuwing' worden behandeld.
Een rij die ooit een prijs bevatte is **niet** automatisch een actuele prijs,
aanbieding, actuele voorraad of aantoonbare besparing.

## Wanneer stoppen

Weiger een dataset bij ontbrekende PLUS- of DekaMarkt-producten, leeg
`offers`-brontype, afwijkende retailer/SHA/URL/timestamp, een onbeschermd
of symlinked SQLite-bestand, of een veranderd rechtenveld. De tools gebruiken
SQLite via `mode=ro&immutable=1` en maken geen zijbestanden.

Deze hulpmiddelen veranderen de productlezer niet; zie de afzonderlijke
productfix en QA-replay bij [#2921](https://github.com/Zennay/Supa/issues/2921).
Het M3-go/no-go blijft **geblokkeerd** totdat de echte gelijkwaardige PLUS 11 +
DekaMarkt 11-metingen binnen 24 uur [#78](https://github.com/Zennay/Supa/issues/78),
geldige gegevensrechten [#74](https://github.com/Zennay/Supa/issues/74),
codeherkomst [#205](https://github.com/Zennay/Supa/issues/205) en permanente
VPS-controle [#2833](https://github.com/Zennay/Supa/issues/2833) aantoonbaar
zijn afgerond. Geen automatische live crawl, CAPTCHA-omweg of financiële
publicatie op basis van deze QA-rapporten.
