# M3 privé-voortgang — onafhankelijke veilige QA-leesroute

**Beperkte QA-referentie, niet de officiële productfix of M3-goedkeuring.** Het bestaande `scripts/m3-private-field-progress.mjs` blijft in de aparte [P1 #3785](https://github.com/Zennay/Supa/issues/3785) een onveilig lokaal bestandspad lezen. De onafhankelijke read-only QA-variant uit [gemergede #3787](https://github.com/Zennay/Supa/pull/3787) gebruikt wél een gepinde en begrensde descriptor.

## Lokale demonstratie (géén echte metingen uploaden)

1. Bewaar uitsluitend een zelf beheerd, canoniek M3 JSON-concept buiten de repository in een privé-directory met modus `0700`. Het bronbestand moet een normaal, enkel gelinkt bestand zijn met `0600` of strenger voor group/others, en **exact dezelfde POSIX-eigenaar UID hebben als het huidige proces**. Zelfs bij verheven leesrechten is een bestand van een andere UID geen bewijs van deze operator. Gebruik geen symlinks, hardlinks of gedeelde tijdelijke directories met niet-vertrouwde schrijvers.
2. Voer op een lokaal vertrouwd systeem uit:

   ```bash
   node --experimental-strip-types scripts/qa-m3-private-field-progress-readguard-20261017.mjs /eigen/privé/observatie.json
   ```

3. De uitvoer is uitsluitend een 11×2 statusrapport met `evidenceStatus: 'unverified-operator-draft'`, `verifiedRetailerObservations: false` en `publicSavingsClaimEligible: false`. Een 'readyForPrivateReview' is **alleen** een voorbereiding voor menselijke controle, geen winkel- of besparingsbewijs.
4. Bij onveilig bestand (group-/world-readable, verkeerde eigenaar-UID, link, ongeldige/bovenmaatse bytes, malformed JSON) of fout wordt alleen een generieke weigering naar stderr geschreven, **geen privésource-pad, inhoud, prijs of deelnemer-ID**. Gebruik de output nooit als publieke M3-evidentie.

## Werkelijke grenzen en CI

- Maximaal 2 MiB UTF-8, één descriptor met `O_NOFOLLOW|O_NONBLOCK`, gecontroleerde gewone `lstat`-ouders en leaf, private rechten/nlink, **UID-match met de huidige operator bij `lstat` én `fstat`**, identiteit tegen beide file-stat snapshots, en afgebakende parse. Geen netwerk, geen bestandsschrijfoperatie.
- Controle van de voorouderpaden is *best effort*. Bij een aanvaller die de bovenliggende directory gelijktijdig mag hernoemen is de path-check niet race-proof. Werk daarom **alleen** in een door de eigenaar gecontroleerde privé-directory; geen claim op hermetische sandbox.
- Rechten op externe retaildata zijn niet verleend door deze tool. PLUS/DekaMarket blijft `productionReady:false` tot schriftelijke bronrechten [#74](https://github.com/Zennay/Supa/issues/74); de echte gepaarde 11+11 metingen [#78](https://github.com/Zennay/Supa/issues/78) zijn niet vervangen door synthetische tests.
- De aparte onveranderde *fail-first* tests en de werkelijke productfix blijven [#3784](https://github.com/Zennay/Supa/pull/3784) / [#3785](https://github.com/Zennay/Supa/issues/3785). De zelfstandige QA-variant is reeds gemerged; **de originele product-CLI blijft onaangeroerd en is niet automatisch veilig**. Original fail-first test [#3840](https://github.com/Zennay/Supa/pull/3840) voor verkeerde UID is apart immutabel opnieuw getest als RED→GREEN, zonder de testbranch te wijzigen. Toets elke laatste SHA met officiële `npm ci`, high-audit, `npm test`, matching, canoniek denied-rights gate en build. Zonder onafhankelijke scoped source-/mergelease blijft de PR **DRAFT/NONMERGE**.

Deze testtool analyseert alleen lokaal bestaande conceptbytes; hij meet geen winkels, toont geen echte prijzen en valideert geen statistisch besparingsresultaat.
