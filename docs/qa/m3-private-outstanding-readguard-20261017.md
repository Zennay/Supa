# SUPA M3 — veilige privéchecklist voor de 22 PLUS/Deka-regels

Met `scripts/qa-m3-private-outstanding-field-readguard-20261017.mjs` krijgt de operator een *alleen-lezen* overzicht van welke ingrediënten, verpakkingen en beschikbaarheid in het originele M3-veldformulier nog ontbreken. Deze onafhankelijke QA-tool gebruikt dezelfde canonieke product-logica als de bestaande bron-eigenaars-CLI; hij schrijft **niet** in het origineel en verzint nooit ontbrekende prijzen.

## Veilig bestandsinvoer

De JSON-invoer moet een regulier bestand zijn van de huidige operator, enkelvoudige hardlink, privérechten `0600`, **maximaal 2 MiB**, geen symlink in het pad en geldige volledige UTF-8/JSON. De tool leest via één vastgepinde descriptor met voor- en nacontrole van UID, inode, apparaat, bestandsrechten, linkaantal, grootte en wijzigingstijden. Ongeldige bestanden, onveilige paden en ontbrekende canonieke 11×2-behoeften worden met één algemene fout geweigerd, zonder persoonlijke gegevens of bestandspaden te tonen.

## Gebruik

```sh
node --experimental-strip-types scripts/qa-m3-private-outstanding-field-readguard-20261017.mjs \
  /prive/map/m3-original-field-sheet.json

node --experimental-strip-types scripts/qa-m3-private-outstanding-field-readguard-20261017.mjs \
  /prive/map/m3-original-field-sheet.json --text
```

De JSON- en Nederlandstalige tekstmodus tonen alleen de **vaste canonieke ingrediënten en hoeveelheden**, openstaande PLUS/DekaMarkt-regels en neutrale acties. ParticipantKey, winkel-ID, productnamen, prijzen, bron-URL's en tijdstempels blijven verborgen. Een complete checklist betekent enkel `readyForPrivateReview`; de rapportages houden altijd `verifiedRetailerObservations:false`, `publicSavingsClaimEligible:false` en de status `unverified-operator-draft`.

Dit is een **additief QA-alternatief** voor de bestaande product-CLI `m3-private-outstanding-field-actions.mjs`: die productcode en zijn eigenaar worden niet gewijzigd. Het is evenmin een productierelease-gate of juridische toestemmingscontrole. Formele M3-validatie vereist nog de echte gelijksoortige 11+11 winkelwaarneming binnen 24 uur [#78](https://github.com/Zennay/Supa/issues/78), vastgelegde codeherkomst [#205](https://github.com/Zennay/Supa/issues/205), bronrechten [#74](https://github.com/Zennay/Supa/issues/74) en de vertrouwde VPS-runner [#2833](https://github.com/Zennay/Supa/issues/2833).

## Regressies

```sh
node --experimental-strip-types --test tests/qa-m3-private-outstanding-readguard-20261017.test.mjs
```

Alle tests draaien uitsluitend met lokale fictieve operatorinformatie, zonder retailer-HTTP of echte winkelprijzen.
