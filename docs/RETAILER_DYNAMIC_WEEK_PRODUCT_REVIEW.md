# SUPA — variabele weekplanning → één universele retailer-review

De eerste private catalogusmatching [PR #2910](https://github.com/Zennay/Supa/pull/2910) koppelt historische offline bronnen aan de vaste 11 M3 behoeften. Deze uitbreiding maakt dezelfde engine meteen **weekplanner-afhankelijk**: de geselecteerde dagen/maaltijden bepalen eerst de exacte totale fysieke ingrediënthoeveelheid, daarna pas komen de winkelonafhankelijke productmatching en de twee winkelspecifieke reviews.

## Werkende offline opdracht

Met Node en de bestaande testmaaltijden, volledig **zonder netwerk**, optioneel alleen maandag en donderdag:

```bash
node --experimental-strip-types scripts/retailer-reviewed-custom-week.mjs --days Ma,Do
```

Zonder `--days` worden de vier werkdagen uit `m2InitialPlan` gebruikt. `Ma,Do` plant twee keer de Tikka-bowl en levert **5 unieke ingrediëntenbehoeften × 2 winkels = 10 reviewregels**. Daarbij wordt onder andere 300 + 300 gram kippendij **600 gram** en 1 + 1 bloemkool **2 stuks**, volgens de bestaande `aggregatePlanIngredients`-regels. Alle vier oorspronkelijke geplande dagen resulteren in **11 behoeften × 2 = 22 regels**.

## Ingebouwd in de echte plannerlogica

`buildDynamicReviewedWeek({catalog,plan,recipes,activeDays})` accepteert andere weekplannen en recepten met dezelfde formele basket-typen. Dubbele dagen, ontbrekende recepten, tegenstrijdige identieke ingrediënten, ongeldige dagwaarden en niet-bekende hoeveelheden worden geweigerd. De code maakt geen nieuwe/bedachte prijzen, `packCount`, `ObservationSheet`-veldevidence of financiële vergelijking; alleen interne historische kandidaatvoorstellen `suggested-for-manual-review` of `unresolved`.

De commandline toont alleen **aantallen** (`activeDays`, `uniqueIngredientNeeds`, `retailerReviewRows`, `proposedForManualReview`, `unresolved`) en de expliciete veilige waarden `livePricesAvailable:false`, `publicSavingsClaimEligible:false`, `externalRequests:0`. Niet automatisch de UI vullen met uit 2026-historie afkomstige prijsregels; iedere echte meting vraagt nieuwe menselijke waarnemingen en toestemming.

De uitbreiding raakt geen ingestionworker-bestanden, geen bestaande `src/domain/basket.ts` of `src/domain/matching.ts`, geen bestaande `src/features/` UI, geen externe bronnen of CI-workflows. Productie- en M3-vrijgave blijven afhankelijk van [#74](https://github.com/Zennay/Supa/issues/74), [#78](https://github.com/Zennay/Supa/issues/78), [#205](https://github.com/Zennay/Supa/issues/205) en [#2833](https://github.com/Zennay/Supa/issues/2833).
