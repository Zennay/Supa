# Supa M3 — lokale bestandsgrens voor privé-voortgang (QA, 17 oktober 2026)

**Status: FAIL-FIRST bevestigd; NIET productie-/veldwerk-gereed.** Dit document beschrijft uitsluitend een lokaal inputprobleem van de privé-operator-CLI, niet een openbaar datalek, geldige bronrechten of aangetoonde besparing.

## Reproductie en bevroren regressies

- Main bij eerste controle: `09012443a3f0b50732c2822ab984aabdc7aa21a5`.
- QA-test-only branch: [PR #3784](https://github.com/Zennay/Supa/pull/3784), oorspronkelijke commit `bb77b2d5cf084f6f1c92167e234b09fce7add2d4`.
- [GitHub-hosted CI #39014538814](https://github.com/Zennay/Supa/actions/runs/39014538814), job `117343788406`: native checkout `ee61ec9` met precies die head + main; `npm ci` en `npm audit --audit-level=high` geslaagd; **3.231/3.237 tests PASS, exact zes gerichte FAIL** (#2458–2463), geen andere failures/skips/cancelled/todo. De reguliere `0600`-controle is GROEN. Matching, werkelijke rechtencheck en build zijn na de opzettelijke test-RED niet gedraaid.
- [GitHub issue #3785](https://github.com/Zennay/Supa/issues/3785) koppelt deze zes ongewijzigd te behouden regressies aan de onafhankelijke product-code-eigenaar.

| Invoer | Verwacht | Bevroren test |
| --- | --- | --- |
| Gewoon enkel-gelinkt regulier `0600`-bestand | Alleen anonieme 11×2 voortgang; niet verified/claimable | Positieve controle |
| Regulier bestand met group-read `0640` | Weiger voor lezen | #2458 |
| Regulier bestand met world-read `0644` | Weiger voor lezen | #2459 |
| Eindpad is symlink naar veilig bestand | Weiger | #2460 |
| Een bovenliggende directory is symlink | Weiger | #2461 |
| Bestand heeft meerdere hardlinks | Weiger | #2462 |
| Syntactisch geldig JSON-bestand >2 MiB aan UTF-8 bytes | Weiger vóór onbegrensde parse | #2463 |

## Huidige operatorveiligheid

**Gebruik `scripts/m3-private-field-progress.mjs` voorlopig niet als bewijs dat een lokaal bestand privé of veilig toegelaten is.** De CLI geeft geaggregeerde status maar gebruikt op de onderzochte main gewone `readFile(path, 'utf8')`, waardoor de zes afwijkende bestandsvormen niet worden geweigerd. Geef geen echte deelnemeridentiteiten, bestanden, ruwe paden, hashes of prijsmetingen door via GitHub-issues, CI-output of PR's.

De reeds aanwezige `scripts/m3-private-evidence-fingerprint.mjs` heeft een veel striktere lokale 0600/regular/nlink/no-follow/2MiB-toegangscontrole. **Zijn digest valideert uitsluitend bytes**; hij levert op zichzelf geen autorisatie, bescherming tegen gelijktijdig gewijzigde parent directories, prijsverificatie of bewijs van echte veldmetingen. Een vooraf berekende digest maakt een latere onbeveiligde `readFile` niet automatisch veilig wegens TOCTOU.

## Gescheiden product-correctie en acceptatie

1. Alleen de exclusieve product-core-eigenaar mag `scripts/m3-private-field-progress.mjs` veranderen. Open een werkelijk veilig, niet-blokkerend descriptor en controleer bovenliggende paden, eindbestand, private mode, `nlink === 1`, identiteit, begrensde bytes en stabiele `fstat` vóór JSON-verwerking. Geen tweede onbeveiligde path-open na de controle.
2. Houd onbetrouwbare argumenten en bestandspaden buiten stderr/stdout, weiger ongeldige bytes zonder gedeeltelijk JSON en behoud de huidige correcte aggregatiestatus voor het canonieke blanco 11×2-concept.
3. Laat de **oorspronkelijke** QA-testfile uit commit `bb77b2d5` byte-identiek opnieuw lopen op de productfix. Bewijs 6/6 groen en alle bestaande gates op **exact die laatste codehead**: `npm ci`, high-audit, `npm test`, matching benchmark, werkelijke afgewezen retailerrechten en TypeScript/Vite-build.
4. Beschouw een succesvolle test-/buildrun niet als toestemming om naar productie of main te mergen: product-schrijverslease en afzonderlijke beschermde mergerlease blijven nodig. Schriftelijke PLUS/Deka rechten [#74](https://github.com/Zennay/Supa/issues/74), echte menselijk gepaarde 11×2 metingen [#78](https://github.com/Zennay/Supa/issues/78), veldcode-SHA [#205](https://github.com/Zennay/Supa/issues/205) en permanente runner [#2833](https://github.com/Zennay/Supa/issues/2833) zijn aparte HOLD-gates.

**Geen echte retailers bezocht, geen prijs opgehaald, geen fictieve besparing gepubliceerd.**
