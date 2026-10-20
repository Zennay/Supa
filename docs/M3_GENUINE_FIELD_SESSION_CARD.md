# SUPA M3 — veldsessiekaart (echte observatie, issue #78)

**Status: nog niet gestart.** Deze kaart is voor de menselijke verzamelaar van één echte mandvergelijking. Het huidige prototype, een leeg formulier, een synthetische fixture of een groen CI-resultaat levert **geen** geobserveerde winkelprijzen en **geen** publieke besparingsclaim op. De volledige technische bron van waarheid blijft [M3_OBSERVED_BASKET_STUDY.md](M3_OBSERVED_BASKET_STUDY.md).

## Start alleen wanneer beide observaties echt uitgevoerd kunnen worden

- [ ] Reserveer dezelfde weekplanning en de **exacte elf** hieronder genoemde behoeften voor beide winkels; pas recepten, hoeveelheden, vervangingen en volgorde niet stilzwijgend aan.
- [ ] Leg vooraf één prijscontext vast: `in-store` **of** `online-order`. Vermeng deze contexten niet, ook niet als de prijsverschillen aantrekkelijk lijken.
- [ ] Verzamel **baseline = PLUS**, daarna **candidate = DekaMarkt**, met dezelfde behoefte; wissel de rollen nooit om.
- [ ] Leg per winkel een afzonderlijk tijdstip vast, met expliciete ISO-tijdzone (`Z` of `±HH:MM`). Maximaal **24 verstreken uren** tussen beide observaties; geen toekomstige tijdstippen.
- [ ] Registreer per winkel `manual-cart`, `receipt` of `consented-export` als bron, met provenance, product/hoeveelheid/pak/prijs en beschikbaarheid per regel. Nooit een onbekende prijs of onbeschikbaar product invullen op basis van aannames.
- [ ] Gebruik alleen met passende toestemming verkregen gegevens. Houd naam, e-mail, account-ID, bonfoto's en ruwe ingevulde formulieren buiten Git.

## Vastzetten vóór de daadwerkelijke veldstart

1. Controleer op GitHub welke `main`-commit **op het moment van de echte veldstart** actueel is. Noteer de volledige SHA en het sessietijdstip buiten de repository.
2. Start **één keer** de GitHub Actions-workflow `.github/workflows/m3-observed-week-report.yml` met `workflow_dispatch` op `main`. Bewaar de run-URL, run-ID, exacte SHA en het artifact `supa-m3-field-run-pack` bij de sessienotities. Het artifact wordt standaard slechts **7 dagen** bewaard.
3. Maak **niet** preventief een nieuwe workflow-run zolang geen echte menselijke collectie gestart is; een latere run uit een gewijzigde `main` mag niet stiekem dezelfde sessie vervangen.
4. Lokaal alternatief op een actuele en vastgelegde `main`:
   `npm run m3:create-observation-sheet -- --output artifacts/m3/observation-sheet.json`.
   De generator weigert overschrijven; maak voor een nieuwe sessie een nieuw pad in plaats van bestaande waarnemingen te wissen.

## Exacte behoefte — 11 regels voor PLUS **en** DekaMarkt

Het zijn **behoeften**, geen geobserveerde producten of geverifieerde prijzen:

- [ ] `basmati-rice` — Basmati rijst — 450 g
- [ ] `broccoli` — Broccoli — 250 g
- [ ] `cauliflower` — Bloemkool — 2 piece
- [ ] `chicken-thigh` — Kippendij — 600 g
- [ ] `coconut-milk` — Kokosmelk — 400 ml
- [ ] `edamame` — Edamame — 150 g
- [ ] `garam-masala` — Garam masala — 20 g
- [ ] `greek-yogurt` — Griekse yoghurt — 100 g
- [ ] `spaghetti` — Spaghetti — 250 g
- [ ] `teriyaki-sauce` — Teriyaki saus — 60 ml
- [ ] `tomato-cubes` — Tomatenblokjes — 400 g

**Per winkel** moet iedere regel eerlijk beschreven worden, ook wanneer het product niet beschikbaar is of de vergelijking daardoor `unknown` wordt. De `piece`-waarde is hier de canonieke interne eenheid; de collector toont een menselijker label.

## Na het veldbezoek — alleen met werkelijk ingevulde data

1. Exporteer de ingevulde `Meten`-collectie-JSON of gebruik de veilig opgeslagen ingevulde observatiesheet. Controleer expliciet dat PLUS de baseline is, DekaMarkt de candidate, de prijscontext identiek is, de elf demand-regels niet zijn aangepast en beide tijdstippen maximaal 24 uur verschillen.
2. Converteer een werkelijk ingevulde sheet: `npm run m3:build-observed-study -- artifacts/m3/observation-sheet.json --output evidence/m3/<study>.json`.
3. Beoordeel de geconverteerde studie: `npm run m3:assess-observed-week -- evidence/m3/<study>.json --output artifacts/m3/<study>-assessment.json`.
4. Bewaar **ook** `same`, `worse` en `unknown` als uitkomsten; geen weglating van ongunstige of onvolledige data. Voor fouten/incompleetheid: corrigeer uitsluitend aantoonbare brongegevens of behoud `unknown`, nooit een synthetische vervanging.
5. Archiveer het privacyveilige oordeel gekoppeld aan run-ID en SHA; deel geen ruwe persoonsgegevens of bonnen via PR's. Eén sessie vormt **geen publieke besparingsclaim**; `publicSavingsClaimEligible: false` blijft van kracht.

**Beslisregel:** geen echte twee-winkelmeting? Laat [GitHub #78](https://github.com/Zennay/Supa/issues/78) open en M3 als niet afgerond; geen workflow forceren, geen fictieve prijzen of bewijsstatus creëren.
