# Supa — historische bronvergelijking: ononderbroken dekking en SHA-inhoudstrouw

De privé historische productvergelijker moet met gecontroleerde PLUS- en DekaMarkt-bewijzen werken. Een fout of ontbrekende bron is nooit feitelijk bewijs dat een winkel een product heeft verwijderd. Een ongewijzigde bron-SHA van dezelfde HTTPS-bron is evenmin verenigbaar met gewijzigde inhoudelijke prijs- of voorraadfeiten.

## Twee nieuwe harde weigeringen

**Volledige brondekking verplicht.** Beide gecontroleerde offline batches moeten voor PLUS en DekaMarkt product, catalogus en aanbiedingen ten minste één positief geaccepteerde bron bevatten. Elk afgewezen bronrecord in één van beide batches maakt de volledige veranderingentelling ongeldig, ook als dezelfde bronvorm daarnaast een ouder goedgekeurd record heeft. Een verdwenen product mag uitsluitend geteld worden tussen twee complete, foutvrije datasets, en nog steeds niet als `unavailable` of gratis worden geïnterpreteerd.

**SHA-inhoudscontinuïteit verplicht.** Wanneer dezelfde bron-URL en exact dezelfde cryptografische bron-SHA opnieuw worden gezien voor hetzelfde bronproduct, mogen naam, centsprijs, aanbieding, verpakking, beschikbaarheid en productidentiteit niet veranderen, zelfs niet als het hercapture-tijdstip later is en negen fractiecijfers bevat. Verschil betekent dat de kopie of normalisatie onbetrouwbaar is, dus gehele vergelijking weigeren. Een werkelijk ander (in tests fictief) brondigest mag gecontroleerde historische wijzigingen **privé** tellen; dat geeft geen prijs- of hergebruikrecht.

### Bewijs en grenzen

De regressies `tests/product-retailer-fact-coverage-sha-continuity-20261015.test.mjs` gebruiken uitsluitend de bestaande historische zesvorm-fixtures en gecontroleerde in-memory fictieve mutaties. Ze testen ontbrekende/geweigerde bronnen, identiek SHA met verkeerde centprijs/voorraad, identiek SHA met latere correcte tijd en gewijzigde fictieve SHA met geaggregeerde prijswijziging.

Dit zijn producttrustgates, **geen live supermarktobservaties, publieke besparingsclaims of M4-vrijgave**. De externe M3-blokkades blijven schriftelijke bronrechten #74, echte PLUS+DekaMarkt 11+11 menselijke 24-uursvergelijking #78, fysieke field SHA #205 en permanente trusted runner #2833.
