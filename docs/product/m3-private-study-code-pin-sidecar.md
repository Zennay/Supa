# Privé M3-studiecodepin (offline sidecar, experimenteel)

Dit product-core hulpmiddel ondersteunt [issue #205](https://github.com/Zennay/Supa/issues/205) zonder de bestaande M3-observatie-, conversie-, rapportage- of QA-bestanden van andere eigenaars te wijzigen. Het is **geen** vervanging voor de verplichte veldrun en sluit issue #205 nog **niet**.

## Gebruik (alleen lokaal, na geldige menselijke meting)

Controleer eerst in GitHub welke echte *main*-revisie tijdens de veldmeting wordt gebruikt. Vervang de expliciete placeholder hieronder door die geverifieerde waarde (de placeholder zelf wordt door de CLI geweigerd). Gebruik geen fictieve of ongetoetste SHA als bewijs. In een privémap buiten iedere Git-repository:

```bash
umask 077
node scripts/m3-field-code-pin.mjs /private/study.json "PASTE_40_HEX_MAIN_SHA_HERE" --output /private/study-code-pin.json
```

De gecontroleerde herstelcheck kan later op dezelfde privépaden draaien:

```bash
node scripts/m3-field-code-pin.mjs --verify /private/study.json /private/study-code-pin.json
```

Bij exact ongewijzigde studiebytes en een onvervalste sidecar toont hij alleen `privateStudyBytesMatch:true` en de drie blijvend false-vlaggen. Bij gewijzigde bytes, ongeldige sidecar of ontbrekend bestand is de uitvoer geen succes en blijven private paden en inhoud buiten de foutmelding. Dit verifieert alleen de **bytebinding**, niet de waarheid van de meting of de werkelijke Git-revisie.

Het hulpmiddel leest alleen een regulier lokaal JSON-bestand, maximaal 4 MiB, zonder symlink of hardlink. Het maakt een **byte-exacte SHA-256** van het volledige bestand en toont uitsluitend manifestvelden. Persoons-/prijsregels worden niet naar stdout geschreven. De sidecar is uitsluitend een controle van de hash-binding; wijzigingen in het originele JSON na generatie maken de verificatie ongeldig. Bewaar beide bestanden privé, versleuteld/afgeschermd en buiten versiebeheer. Het hulpmiddel kan zonder `--output` het manifest alleen naar stdout sturen. Met `--output` schrijft het eerst naar een tijdelijke afgeschermde map (0700) met 0600-bestand, controleert de geschreven inhoud fysiek met fsync, en publiceert pas daarna één nieuwe privé-sidecar (0600) via exclusieve hardlink; bij schrijffout blijft er geen onvolledig uitvoerbestand staan. Exclusieve publicatie betekent: geen overschrijven, geen bestaande symlink of Git-checkout als bestemmingspad, en geen symlinkende bovenliggende directories. De bovenliggende privémap moet al bestaan.

`sourceCommitSha` is **door de operator opgegeven, niet door de tool tegen GitHub geverifieerd**. De drie vlaggen `codeRevisionVerified`, `retailerPermissionVerified` en `publicSavingsClaimEligible` blijven daarom expliciet **false**; zet ze nooit handmatig op true. Een digest is geen bewijs dat winkelobservaties echt, bevoegd of binnen 24 uur zijn verzameld.

## Resterende integratie en acceptatie

De gewone M3 converter, `WeeklyBasketStudy` en het assessmentrapport bewaren deze codepin nog niet; zij worden door andere open product/QA-PR's beheerd. Na vrijgave van eigenaarschap: de pin als strikt vereist veld in de collector opnemen, exact behouden in converter en rapport, ontbrekende of ongeldige waarden weigeren en integratietests op de actuele `main` plus toepasselijke permanente VPS-gates uitvoeren. Geen merge of live publicatie zonder toegestane scope en controles.

Echte veldgate: [#78](https://github.com/Zennay/Supa/issues/78) 11 PLUS + 11 DekaMarkt in dezelfde prijscontext binnen 24 uur; schriftelijke hergebruikrechten [#74](https://github.com/Zennay/Supa/issues/74) blijven afzonderlijk nodig. Geen retailer-HTTP en geen publieke besparingsclaim via deze tool.
