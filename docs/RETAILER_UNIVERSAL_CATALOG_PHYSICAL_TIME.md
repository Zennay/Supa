# SUPA: echte fysieke capturereeks in historische PLUS/Deka-catalogus

De universele review-catalogus combineert de zes bestaande historische PLUS/DekaMarkt-ingestiebronnen. De oorspronkelijke `capturedAt.localeCompare` sorteerde de letterlijke ISO-tekst. Wanneer captures verschillende UTC-offsets hebben, kan dat de **fysieke** volgorde omkeren. Bovendien mag een direct JS-aanroepende module geen genormaliseerde onmogelijke datums zoals 30 februari als authentieke opname gebruiken.

De bronfix valideert iedere opname nu als echte ISO-kalenderdatum met geldig dag/maand/jaar, kloktijd en civiele offset (maximaal ±14:00). Hij berekent de fysieke UTC-instant inclusief alle 1–9 fractional digits **tot en met één nanoseconde**. Daarna worden captures eerst op die fysieke tijd gesorteerd; bij exact gelijke fysieke instanties geldt lexicale tijdtekst en vervolgens de bestaande SHA/source/waarheids-tiebreakers. Ongeldige of toekomstige tijdstempels worden bij de directe catalogus-API geweigerd. Er worden geen individuele bronwaarden, toelatingen, identiteiten of werkelijke prijzen gegenereerd.

## Ongewijzigde onafhankelijke acceptatie

- Originele QA [PR #3050](https://github.com/Zennay/Supa/pull/3050) blob `f8d69b471839ca978a5f6d0d46a19dd9c5bce0cd`: twee oorspronkelijke gehoste **RED** UTC-mixed-order gevallen, plus oude correcte UTC-positieve controles.
- Originele QA [PR #3053](https://github.com/Zennay/Supa/pull/3053) blob `87adcdd4644b45e7173430bd8cb7af791dcc9878`: twee onafhankelijke onmogelijke kalenderdatumgevallen, plus complete historische zes-bronnencontrole.
- Vier nieuwe eigenaarcontroles: +1ns volgorde, gelijke fysieke instant met andere UTC-tekst, ongeldige offsets/kalenderdagen, en zes oorspronkelijke ongewijzigde M1-fixtures.

Alle tests zijn lokaal/offline en gebruiken de bestaande historisch reviewed PLUS-fixture met **fictieve datumvariaties**. Geen netwerk, geen echte toegang tot PLUS of DekaMarkt, geen nieuwe geldbedragen, geen actuele prijzen en geen publiek besparingsresultaat.

Een puur technische cataloguscontrole vervangt nooit schriftelijke bronrechten #74, echte menselijke gelijkwaardige 11+11 ≤24 uur M3-observaties #78, field code SHA #205 of de betrouwbare M3 runner #2833. `currentTrustedPriceCents:null`, `sourceRightsVerified:false`, `publishable:false` blijven ongewijzigd.
