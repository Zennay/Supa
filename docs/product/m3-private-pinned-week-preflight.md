# Privé M3-weekpreflight met codepin — gestapeld op #2837

**Status:** product-core integratievoorbereiding voor [issue #205](https://github.com/Zennay/Supa/issues/205), **geen** bewijs van echte waarnemingen en **geen** vrijgave.

Gebruik pas met lokaal bewaarde private M3 `WeeklyBasketStudy`-JSON en het bijbehorende codepin-sidecarbestand uit [PR #2837](https://github.com/Zennay/Supa/pull/2837):

```bash
node --experimental-strip-types scripts/m3-verify-private-week-preflight.mjs /private/study.json /private/code-pin.json
```

De preflight doet **geen netwerkverzoeken**. Beide bestanden worden via een nonblocking, no-follow bestandsdescriptor begrensd gelezen (studie maximaal 4 MiB, manifest maximaal 4096 bytes; geen symlink of hardlink). De oorspronkelijke bytes worden met het private manifest vergeleken. De studie-JSON zelf wordt vóór het gewone inlezen recursief gecontroleerd op **dubbele gedecodeerde veldnamen**, inclusief geneste prijzen, winkelmandregels en escape-aliases. Een ondertekende bytehash mag een tegenstrijdig, door JSON.parse last-wins geïnterpreteerd onderzoeksbestand nooit goedkeuren. Het manifeste, strikt unieke broncommitveld wordt behouden. Vervolgens controleert de bestaande M3-assessor of het onderzoeksbestand valide is, dat het om PLUS versus DekaMarkt gaat, en of beide manden exact de **11 canonieke ingrediëntvraagregels** in de juiste volgorde en hoeveelheid voor de gekozen plannerfixture bevatten. Ook wordt een **harde** tijdsgrens toegepast: een paar met meer dan 24 uur onderling verschil, een waarneming buiten de planningsweek plus twee voorafgaande boodschappendagen, een onmogelijke kalenderdatum of een toekomstige meting wordt expliciet geweigerd (CLI exitcode 1), in plaats van slechts een waarschuwing te tonen. Onbekende beschikbaarheid is toegestaan, maar vormt geen besparingsbewijs.

De uitvoer bevat alleen algemene vlaggen en de opgegeven bron-SHA; **geen deelnemerssleutel, geobserveerde prijzen, winkelbonnen, persoonlijke notities of geldbedragen**. `codeRevisionVerified`, `retailerPermissionVerified`, `publicSavingsClaimEligible` en `sourceCommitShaAuthenticated` blijven altijd `false`. Een bron-SHA is slechts door de menselijke operator opgegeven: deze tool controleert niet of het daadwerkelijk de `main` commit tijdens de meting was.

**Nog open vóór claim of volledige issue-sluiting:** collector- en convertercontract moeten, na vrijgave van actieve eigenaars, de commitpin duurzaam opnemen in `WeeklyBasketStudy` en in het canonieke assessmentrapport; huidige preflight is een apart privéproces. Ook ontbreken echte PLUS11 + Deka11 observaties binnen 24 uur ([#78](https://github.com/Zennay/Supa/issues/78)), schriftelijke bronrechten ([#74](https://github.com/Zennay/Supa/issues/74)), toepasselijke VPS-acceptatie en geautoriseerde zCloud SQLite-scopeclaim. Niet mergen of deployen op basis van hosted tests alleen.
