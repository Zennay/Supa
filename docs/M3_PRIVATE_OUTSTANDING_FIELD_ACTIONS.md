# SUPA M3 — welke winkelregels moeten nog echt worden gemeten?

Deze kleine lokale product-corefunctie helpt de **echte** twee-winkelsmeting uit [issue #78](https://github.com/Zennay/Supa/issues/78). Hij is geen scraper, geen prijsfeed, geen bewijs dat iemand een winkel bezocht heeft en maakt geen publieke besparingsclaim.

## Gebruik

Maak of bewaar het bestaande privé-metingsformulier (`Meten` of `m3:create-observation-sheet`). Lees daarna uitsluitend lokaal:

```sh
node --experimental-strip-types scripts/m3-private-outstanding-field-actions.mjs private-sheet.json
```

De uitvoer bevat **alle nog openstaande canonieke ingredientregels**, afzonderlijk voor PLUS en DekaMarkt. Daardoor kun je in dezelfde 24-uursmeting de overgebleven regels gericht afwerken. `record-availability` betekent dat beschikbaarheid nog niet is vastgelegd; `complete-product-pack-and-price` betekent dat een als beschikbaar geregistreerd product nog niet compleet is qua product, verpakking of prijs. Een **expliciet geobserveerd niet-beschikbaar** product wordt beschouwd als ingevulde veldregel, niet als gekochte of geprijsde regel.

Alle labels en hoeveelheden zijn afkomstig uit de M2-planner, nooit uit vrije gebruikerstekst. Vrije winkelinformatie, persoonsgegevens, prijzen, productnamen, bronlinks, evidence IDs en tijdstippen worden niet uitgegeven; alleen een grove status `not-started`, `single-observation`, `within-window` of `outside-window`. Een defect formulier wordt geweigerd; er wordt geen invoerbestand geschreven of overschreven.

**Cruciaal:** `readyForPrivateReview` betekent hoogstens dat een operator privé kan nakijken; `verifiedRetailerObservations` en `publicSavingsClaimEligible` blijven ook bij complete fictieve testgegevens altijd `false`. De menselijke controle, exact 11+11 echt gemeten regels binnen 24 uur, dezelfde prijscontext en eventuele rechten op bronnen blijven verplicht. Dit vervangt noch de bestaande Meten-converter, noch de retailer-pipeline uit de concept-PR.
