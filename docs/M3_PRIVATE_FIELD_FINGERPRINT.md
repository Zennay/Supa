# M3 privé-concept: bestandsintegriteit bij overdracht

Een echte meting voor [M3 veldwerk #78](https://github.com/Zennay/Supa/issues/78) blijft menselijk werk: dezelfde 11 boodschappen bij PLUS en DekaMarkt, binnen 24 uur, onder één prijscontext. Bewaar die gegevens uitsluitend privé. Een SHA-256-controle bevestigt **alleen dat dezelfde bytes behouden zijn**; hij valideert geen winkelprijzen, toestemming, productvergelijking, onderzoeksdeelname of besparing.

## Gebruik bij de handoff

1. Maak het eigen veldconcept lokaal aan via de bestaande M3-observatieflow. Bewaar het als privé JSON-bestand, niet in deze repository. Gebruik een eigen, ontoegankelijke werkdirectory.
2. Zorg dat het bestand alleen leesbaar/schrijfbaar is voor de eigenaar: `chmod 600 /privé/pad/observatie.json`. Vermijd symlinks en hardlinks.
3. Voer lokaal op **het originele bestand** uit:

   ```bash
   node scripts/m3-private-evidence-fingerprint.mjs /privé/pad/observatie.json
   ```

4. Bewaar de getoonde `bytes` en `sha256` alleen in de afgeschermde onderzoeksadministratie. Voer dezelfde opdracht vlak vóór converter/assessment opnieuw uit. Alleen als **beide** waarden gelijk zijn, kun je zeggen dat de bronbytes sinds de eerdere controle niet veranderd zijn.
5. Gebruik daarnaast de bestaande converter/assessment en vereiste menselijke bewijs- en bronrechtenchecks. Verschillende hashes betekenen: stop, vergelijk de privébron lokaal en herbeoordeel de overdracht; vul nooit ontbrekende metingen of prijzen aan met aannames.

## Beveiliging en grenzen

- Leest maximaal 2 MiB vanaf één regulier, enkel gelinkt bestand met privé rechten (geen group/other bits), weigert symlinkpaden, corrupte UTF-8/JSON en onverwachte 11+11-documentvorm.
- Het oorspronkelijke bestand wordt niet veranderd, geüpload of als inhoud geprint. Bij fouten worden geen privépad, ruwe JSON, prijzen of identifiers getoond.
- De SHA-256-waarde zelf kan een specifiek privébestand identificeren en hoort **niet** in publieke issues, logs, PR's of release-notities.
- De controle leest een gepinde final file-descriptor. Het controleren van bovenliggende directorypaden is best-effort; vertrouw niet op een adversariële beschrijfbare directory.
- De buitenkant van 11+11 wordt gecontroleerd, niet het bestaan van echte waarnemingen. Een fictieve of onvolledige dataset kan nog steeds een geldige hash krijgen. Supa blijft M3 **PRIVATE HOLD** totdat daadwerkelijk gemeten #78 en schriftelijke retailer source rights zijn beoordeeld.
