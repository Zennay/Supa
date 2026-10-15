# SUPA — één offline opdracht voor zes gecontroleerde supermarktadapters

Voorheen waren vier losse stappen nodig: reviewed JSON-gegevens controleren, bestandssamenvatting plus SHA's handmatig schrijven, de zes bestaande PLUS/DekaMarkt-adapters uitvoeren en de cataloguskwaliteit interpreteren. **Nu kan de operator de volledige offline bewijsroute uitvoeren met één opdracht**, zodra *rechtmatig verkregen, handmatig gecontroleerde* brondata aanwezig is.

```sh
umask 077
# Maak vooraf een eigen 0700 map met 6–32 losse, al gecontroleerde
# evidence JSON-bestanden: capture-0.json ... capture-5.json, allemaal 0600.
node --experimental-strip-types scripts/retailer-private-offline-end-to-end.mjs --dir private/reviewed-captures
node --experimental-strip-types --test tests/product-retailer-private-offline-end-to-end-20261015.test.mjs
```

Het script voert werkelijk de bestaande functies `buildPrivateReviewedManifest` en `replayPrivateReviewedCaptureDirectory` achter elkaar uit:
1. Checkt zes vereiste bronvormen: PLUS en DekaMarkt × product, catalogus, aanbiedingen.
2. Controleert officiële beoordeelde JSON-vormen met de actuele bronadapters, het bron-/verpakkingsmodel en de universele privécatalogus.
3. Maakt **zonder bestaande bestanden te overschrijven** het privé `0600` manifest, inclusief SHA-256 over alle bronbestandsbytes.
4. Leest die bestanden opnieuw met SHA-verificatie en fysieke bestandscontroles om te bewijzen dat de adapterpijplijn daadwerkelijk uitvoerbaar is.
5. Drukt uitsluitend aggregaten af: bronnen, observaties, producten, captures, conflicten en historische ouderdom. Geen productnaam, prijsbedrag, SKU, URL, SHA of capturebestandspad wordt getoond.

Het commando is **opzettelijk eenmalig** per reviewmap. Een bestaande `manifest.json` wordt niet vervangen; een nieuwe bronrevisie hoort in een afzonderlijke privémap, zodat bronhistorie onveranderlijk blijft. Als een fout optreedt na manifestcreatie blijft dit bestand voor onderzoek bestaan, maar er wordt geen succesvol CLI-resultaat of catalogus gepubliceerd.

Het systeem leest **geen HTML rechtstreeks**, bezoekt geen retailwebsite, kiest geen nieuwe CSS-selectors, omzeilt geen winkelbeveiliging en bewaart de catalogus niet publiek. Ruwe captures moeten vooraf rechtmatig zijn verkregen en geconverteerd naar de aantoonbaar juiste, door een mens beoordeelde adapter-evidence. Zonder geschreven retailbronrechten is het geen live scraper en geeft het geen actuele besparingsclaim. Op alle rapporten blijven `permissionVerified:false`, `productionEnabled:false`, `livePricesAvailable:false`, `publicSavingsClaimEligible:false`.

**M3 release-holds ongewijzigd:** #74 schriftelijke PLUS/Deka-toestemming, #78 menselijke echte 11×2 winkelmandwaarnemingen in één ≤24-uurs context, #205 broncodepin, #2833 permanente VPS runner.
