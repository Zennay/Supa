# SUPA — één uitvoerbare privé-M3 ingestiecontrole

**Product-core, 15 oktober 2026.** De bestaande zes gereviewde PLUS/DekaMarkt
product-, catalogus- en aanbiedingenadapters, universele producthistorie,
24-uurs brongezondheid, reguliere bronrechtenregistratie en onafhankelijke
historische-aanbiedingencontrole werkten al afzonderlijk. Deze nieuwe operator
*preflight* voert ze **in één run** achter elkaar uit en controleert dat hun
aantallen en veilige release-status elkaar niet tegenspreken.

```sh
node --experimental-strip-types scripts/retailer-private-m3-ingestion-preflight.mjs
node --experimental-strip-types scripts/retailer-private-m3-ingestion-preflight.mjs --at 2026-10-15T10:00:00.000Z
node --experimental-strip-types --test tests/product-retailer-private-m3-ingestion-preflight.test.mjs
```

De bron is uitsluitend de zes historische beoordeelde M1-fixtures in de
repository en het bestaande `evidence/m1/source-permission-gate.v1.json`.
Er zijn **nul** netwerkverzoeken. Zonder argument geldt de auditklok van nu.
`--at` is alleen een reproduceerbare UTC-auditklok, geen bewijs van een
nieuwe opname of actuele prijs.

De JSON-uitvoer bevat uitsluitend totalen, inclusief een uitsplitsing per keten en per bronsoort (PLUS/DekaMarkt × product/catalogus/aanbiedingen) met reviewstatus en aantallen; er verlaten geen productrijen de privéomgeving. De gecontroleerde uitsplitsing telt exact op tot het totaal van de adapterobservaties. Verder toont het geaccepteerde bronsoorten,
historische productobservaties, tegenstrijdige productfeiten, verouderde
archieven en wel/niet onafhankelijk bevestigde historische aanbiedingen.
Het toont **geen** productnaam, centbedrag, bron-URL, bronhash, persoonlijke
gegevens of winkelmandje. De integratie weigert incomplete of tegenstrijdige
input in plaats van stilzwijgend een ontbrekende bron als een gevonden prijs te
behandelen. Een onbekende aanbieding telt als **niet-gecontroleerd**, nooit
als korting of besparing.

**Harde grens:** `releaseDecision:"hold"`,
`permissionVerified:false`, `productionEnabled:false`,
`publicSavingsClaimEligible:false`. PLUS en DekaMarkt hebben nog geen
aangetoonde hergebruikstoestemming. De echte menselijke 11 PLUS + 11
DekaMarkt meting binnen 24 uur (#78), schriftelijke bronrechten (#74), code
SHA op de feitelijke field run (#205) en betrouwbare permanente runner
(#2833) blijven zelfstandig nodig. Deze tool is geen HTTP-scraper, scheduler,
autorisatiegever of claim dat historische fixtures actuele prijzen bevatten.

De nieuw toegevoegde tests gebruiken alleen de bestaande versiegebonden
historische M1-fixtures plus gemanipuleerde **lokale** kopieën voor negatieve
tests. Ze starten ook het echte Node CLI-pad en toetsen redactie en
eigenschap-getters, zonder de immutable peer-QA-bestanden te wijzigen.
