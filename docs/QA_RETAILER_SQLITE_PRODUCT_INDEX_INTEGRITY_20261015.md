# Supa QA — volledige SQLite product- en indexintegriteit (offline M3)

## Waarom dit erbij hoort
De eerdere zes-bronnencontrole vergeleek **alle 16 prijswaarnemingen** met de
historische, beoordeelde PLUS- en DekaMarkt-captures. Dat controleerde reeds
bron-URL, soort, tijdstip, SHA, retailer, product-ID, prijs, pakinhoud,
beschikbaarheid en aanbieding.

Een relationele database kan desondanks onjuiste niet-geobserveerde catalogusrijen
of onjuist afgeleide `search_name`-waarden bevatten, terwijl de aantallen van
snapshots en prijswaarnemingen onveranderd blijven. De planner mag zulke
ongedekte zoekresultaten niet als gecontroleerde catalogusfeiten behandelen.

Deze aanvullende QA-check sluit drie resterende gaten in de bestaande
`scripts/qa-retailer-reviewed-db-exact-parity.mjs`:

1. **Iedere catalogusrij moet een gekoppelde fysieke bronwaarneming hebben**.
   De volledige set `(retailer_id, source_product_id, display_name)` wordt
   teruggebonden aan de geverifieerde observaties. Een extra SKU zonder
   prijswaarneming wordt dus geweigerd, in plaats van overgeslagen.
2. **De afgeleide zoekindex moet reproduceerbaar zijn.** De in de importer
   gebruikte normalisatie (Unicode NFKC, casefold, meerdere witruimtes
   samenvouwen) wordt onafhankelijk herberekend; gemanipuleerde
   `search_name`-velden worden geweigerd.
3. **Private metadatavlaggen zijn exact.** De vijf vaste
   `metadata`-sleutels moeten aanwezig zijn zonder een extra schaduwrecord,
   bijvoorbeeld `license_override`. Een onderzoeksexport verleent nooit rechten.

## Veilig testen

```sh
node --experimental-strip-types --test \
  tests/qa-retailer-db-product-index-integrity-20261015.test.mjs
```

De regressies bouwen ieder een nieuwe database met de **zes historische
lokale bronnen**, brengen één gecontroleerde mutatie aan en eisen daarna
exitcode 2, lege stdout en een generieke foutmelding. Positieve controle:
13 producten, 16 prijswaarnemingen en zes snapshots leveren nog steeds een
geldige, niet-publiceerbare private rapportage op zonder databasewijziging.

De databasechecker zelf opent in read-only/immutable-modus en voert geen
HTTP, scraper-requests of prijs-/SKU-publicatie uit. Resultaat bevat alleen
aggregate aantallen en niet-publiceerbare flags. Mutaties in tests raken
uitsluitend disposable SQLite-bestanden in OS-temp.

**Grenzen:** deze versie is een strikte attestatie van de ingebouwde
schema-v1 historical fixture export, geen universele migratiereader voor
toekomstige schema-versies. Een bronhash in de historische fixture is niet
hetzelfde als actuele retailertoestemming. Een lokale path-to-open race is
niet via deze broninhoudscontrole opgelost; gebruik een alleen door de
operator beheerde, afgesloten private database.

Geen ontheffing van M3-releasegates: echte 11+11 binnen 24 uur [#78],
retailerrechten [#74], code/source-SHA [#205], permanente VPS-gate [#2833].
