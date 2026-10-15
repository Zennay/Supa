# M3 privé veldformuliercontrole — 22 regels, één lokale opdracht

**Status: product-core hulpmiddel in gestapelde concept-PR, geen echte waarneming, geen M4- of besparingsbewijs.**

De M2-planning levert precies elf canonieke ingrediëntvragen. De M3-vergelijking vereist daarvan dezelfde elf bij PLUS en DekaMarkt (22 observatieregels), met de verplichte contextvelden. Tot nu toe waren hiervoor losse technische stappen nodig; deze **offline, read-only** opdracht geeft eerst een veilige voortgangsindicatie en probeert bij volledige invoer in het geheugen de bestaande, strikte M3-converter + privé-weekpreflight.

## Lokaal gebruiken

Maak via de bestaande bronopdracht een formulier, bewaar het lokaal buiten Git en vul het uitsluitend met werkelijk zelf geobserveerde, rechtmatig verkregen gegevens:

```bash
umask 077
node --experimental-strip-types scripts/m3-create-observation-sheet.mjs --output /private/m3-formulier.json
```

Controleer **onafhankelijk** de echte 40-tekens `main`-SHA van het gebruikte onderzoeksproces en voer die expliciet in:

```bash
node --experimental-strip-types scripts/m3-private-field-readiness.mjs /private/m3-formulier.json --expect-main-sha ECHTE_40_HEX_MAIN_SHA
```

Een SHA die alleen door de operator wordt ingevoerd, is **niet door deze tool tegen GitHub geauthenticeerd**. Vervang de placeholder door de gecontroleerde kleine hex SHA (exact 40 tekens). De tool weigert ontbrekende, nul-, ongeldige en niet-canonieke versies, en weigert een niet-regulier invoerbestand, symlink naar de finale bestandsnaam, hardlink, Linux-pipe, >4 MiB, malformed UTF-8 of dubbele (ook Unicode-geëscapete) JSON-veldnamen. Statisch gesymlinkte **bovenliggende directories** worden óók geweigerd. Voor kwaadwillige gelijktijdige directorywissels is nog steeds descriptor-relatieve `openat`-achtige bescherming nodig; behandel dit niet als een racevrije adversarial filesystem sandbox.

## Wat de uitkomst betekent

De JSON-uitvoer toont uitsluitend de **aantallen** geregistreerde beschikbaarheden, volledig ingevulde productregels en vereiste metadata; zowel totaal als **per winkel (PLUS/DekaMarkt)**. Wanneer metadata klaar is maar producten ontbreken, noemt het actieadvies expliciet of eerst PLUS dan wel DekaMarkt moet worden aangevuld, zonder persoonlijke gegevens of productlabels te tonen. Bij een volledig formulier met exact dezelfde canonieke 11+11 vraagregels draait in het geheugen de originele converter op **de oorspronkelijke ongewijzigde JSON-invoer** (niet de voor voortgang herstelde/gecorrigeerde kopie), vervolgens de privé SHA-sidecarverbinding en de tijd/identiteit/preflight. Een door de input vervalste 24-uursgrens kan daarom niet worden weggepoetst doordat de conceptweergave deze voor het tellen normaliseert. `technicalStudyConversionPossible:true` betekent alleen dat de synthetische of private input **technisch** converteerbaar is, nooit dat de prijzen of bronnen onafhankelijk geverifieerd zijn.

Een uitkomst met niet-opgeloste of niet-beschikbare producten blijft duidelijk `review-unavailable-or-unmatched-products`; als alle 22 regels zijn ingevuld, maar metadata of contracten fout zijn, volgt een veilige weigering. **De tool schrijft geen private studie, factuur, prijs, rapport of SHA-sidecar, doet geen netwerkverzoeken en laat geen deelnemer, winkelprijs, URL of pad naar stdout/stderr lekken.**

Voor echt bewijs moeten de bestaande geautoriseerde collector/converter en assessor gebruikt worden; de originele #205 codepin moet duurzaam in `WeeklyBasketStudy` en rapport zijn geïntegreerd. Schriftelijke bronrechten [#74](https://github.com/Zennay/Supa/issues/74), menselijke identieke PLUS11/Deka11 binnen maximaal 24 uur [#78](https://github.com/Zennay/Supa/issues/78), actuele code-authenticiteit, scoped zCloud-write-lease, permanent trusted VPS en onafhankelijkere reviewerbevestiging blijven apart vereist. Alle uitvoervlaggen `fieldObservationVerified`, `sourceCommitShaAuthenticated`, `codeRevisionVerified`, `retailerPermissionVerified` en `publicSavingsClaimEligible` blijven **false**.

## Extra canonieke metadatacontrole (issue #2864)

De onderliggende privé M3 weekpreflight controleert nu ook dat `population`, `region`, `baseline.provenanceNote` en `candidate.provenanceNote` echt **zichtbare, betekenisvolle** inhoud bevatten. Een string van alleen onzichtbare Unicode-formaattekens, lege spaties of loshangende accentmarkeringen mag geen positieve `private-review-only` toelating krijgen. Dit volgt dezelfde zichtbaarheidstest als de canonieke studiebeoordelaar. Een werkelijk onopgeloste winkelmand (bijvoorbeeld niet-beschikbare producten) blijft **wel geldig voor private review**, zonder financiële claim. Het voorkomt dat ongeldige context ten onrechte dezelfde private toelatingsstatus krijgt als een echte, volledig gecontextualiseerde maar onopgeloste studie.
