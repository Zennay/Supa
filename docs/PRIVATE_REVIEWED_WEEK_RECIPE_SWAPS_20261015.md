# SUPA M3 — gecontroleerde recepten wisselen in de privéweekreview

Deze offline productfunctie laat een gebruiker **binnen de bestaande drie M2-demo-recepten** een andere maaltijd kiezen op een reeds geplande dag. Het resultaat is opnieuw berekende fysieke ingrediëntvraag voor PLUS en DekaMarkt in zowel de geheugenreview als de daadwerkelijk tijdelijk opgeslagen SQLite-review, **geen prijs- of besparingsvergelijking**. De retailers worden niet benaderd; uitsluitend de bestaande zes historische lokale fixtures worden gebruikt.

## Zelf proberen (Node met TypeScript-strip ondersteuning)

```bash
node --experimental-strip-types scripts/retailer-reviewed-custom-week.mjs
node --experimental-strip-types scripts/retailer-reviewed-custom-week.mjs --days Ma,Do
node --experimental-strip-types scripts/retailer-reviewed-custom-week.mjs --plan Ma:pasta,Do:pasta
node --experimental-strip-types scripts/retailer-reviewed-custom-week.mjs --plan Ma:tikka,Do:teriyaki
node --experimental-strip-types scripts/retailer-private-sqlite-planner-review.mjs --plan Ma:pasta,Do:pasta
node --experimental-strip-types --test tests/product-private-flexible-week-recipe-swaps-20261015.test.mjs
```

**Goedgekeurde dagen:** `Ma, Di, Wo, Do`. **Demo-recepten:** `tikka`, `teriyaki`, `pasta`. Eén goedgekeurd recept per gekozen dag; minimaal één gekozen dag, maximaal vier. De flags `--days` en `--plan` zijn alternatieven. Onbekende recepten, dagen, extra argumenten en dubbel opgegeven dagen falen voordat bronbestanden worden ingelezen. Ongeselecteerde dagen blijven alleen in het onveranderlijke demo-plan; zij worden niet voor die run berekend.

Voorbeeld: `--plan Ma:pasta,Do:pasta` leidt tot twee maaltijden met dezelfde drie ingrediënten, geaggregeerd over de week, en **zes interne retailerreviewregels** (drie behoeften × twee winkels). Bij het bestaande `--days Ma,Do` blijven de originele recepten, vijf unieke behoeften en tien reviewregels behouden. De uitvoer toont uitsluitend aantallen en de ongewijzigde privacyflags: `livePricesAvailable: false`, `publicSavingsClaimEligible: false`, `externalRequests: 0`.

## Grenzen en acceptatie

- Geen echte PLUS/DekaMarkt-waarnemingen, actuele prijzen, externe recepten of internetrequests.
- Geen wijziging van de M2-fixture, onderliggende matchlogica, gebruikersopslag, prijsberekening, live app-routing of toestemmingsstatus.
- De bestaande `--days`-interface blijft werken en volgt de oorspronkelijke voorgeselecteerde gerechten.
- Nieuwe regressies testen dag-/recept-allowlist, meerdere swaps, dubbele en schadelijke argumenten, weekaggregatie, bestaande receptkeuze en privacy-only uitvoer.
- De tijdelijke SQLite-review gebruikt exact dezelfde gevalideerde dag-/receptkeuze; ongeldige input wordt geweigerd vóórdat een tijdelijk databasebestand wordt aangemaakt. Ook de 6-snapshot privé-persistentielaag behoudt 3 behoeften/6 retailerregels voor Ma+Do pasta, zonder rechten of prijzen te promoveren.
- Product-gehoste CI met volledig Node-testpakket, `npm audit --audit-level=high`, M1 benchmark, rechtencheck en TS/Vite-build is vereist vóór review.
- **DRAFT / NIET MERGEN OF DEPLOYEN** zonder onafhankelijke zCloud scope/SQLite lease, product-/QA-review en toepasselijke permanente VPS-gates.

**Supa is M3 ACTIVE/HOLD.** Voor enige echte besparingsclaim blijven #74 schriftelijke bronrechten, #78 echte menselijke identieke PLUS/DekaMarkt 11+11 binnen ≤24 uur, #205 authentieke field-run codepin en #2833 permanente trusted self-hosted PR-gate vereist.
