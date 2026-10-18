# Boodschappenlijst — controle van de volledige mand vóór tonen, afvinken, kopiëren of printen

Dezelfde actuele winkelmand uit de gekozen planner heeft meerdere gebruikersacties: afvinken (lokaal opgeslagen), de lijst afdrukken, een tekstkopie maken en de voortgang tonen.

Voorheen controleerde de runtime-sleutel voor afvinken vooral de individuele boodschappenregels. Een beschadigde of van een oudere planning afkomstige mand kon een geloofwaardig ogende lijst tonen, terwijl het **totaal**, het **aantal gematchte/onopgeloste regels**, het **aantal geplande maaltijden** of de **winkelidentiteit** niet meer klopte. [Open P1 #3846](https://github.com/Zennay/Supa/issues/3846).

## Werkend productgedrag

- `shoppingListBasketKey` controleert nu vóór alle v1-checkmarkhandelingen de **eigen** winkelnaam en winkel-ID (zichtbaar, geen onzichtbare Unicode-vullers of bidi-controls), niet-negatieve veilige gehele tellers, de som van gematchte/onopgeloste regels, de aanwezigheid van een echte geselecteerde maaltijd bij een gevulde lijst, en het **exacte** mandtotaal als som van de werkelijke geldige regeltotalen.
- Een onvolledige of tegenstrijdige mand krijgt **geen geldige sleutel**. `ShoppingListView` gebruikt al die sleutel als fail-closed toegang voor rendering, lezen, schrijven of afvinken en toont bij weigering een veilige Nederlandstalige melding. Eerder opgeslagen gebruiker-ticks worden bij zo'n fout niet verwijderd of overschreven.
- `preparePrintableShoppingChecklist` controleert dezelfde root voordat de papieren lijst wordt gemaakt; anders ontstaat **geen printbare lijst**.
- `buildShoppingListCopyText` controleert dezelfde root en levert `null` voor onbetrouwbare manden; het bestaande kopieerknopcomponent biedt dan geen tekst.
- `shoppingListCompletion` toont **geen voltooide voortgang** voor dezelfde onbetrouwbare manden.
- Voor alle bestaande **geldige** manden blijft de eerdere serialized `basketKey` bewust exact hetzelfde: normale vinkjes blijven herstelbaar na update. De wijziging introduceert geen migratie, remote backend, winkeldata of verzonnen prijs.

De financiële velden blijven afkomstig uit de bestaande private lokale mandcalculator. Deze bescherming bewijst geen retailerrechten, actuele voorraad, geldige M3-veldprijzen of besparingen.

## Grenzen

Dit is een reparatie van bron-/weergave-integriteit in het bestaande consumentenproduct, geen nieuw QA-testpakket. De bestaande add-only [draft PR #3847](https://github.com/Zennay/Supa/pull/3847) van de andere QA-worker blijft onaangeroerd. De product-P1 wordt pas gesloten wanneer de eigenaar zijn reeds bestaande negatieve voorbeelden tegen de geïntegreerde hoofdbranch hercontroleert. De officiële verplichte CI/build worden door GitHub uitgevoerd; ook een groen resultaat zet bronrechten `productionReady:false` niet automatisch vrij.
