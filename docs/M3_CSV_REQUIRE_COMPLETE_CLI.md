# Opt-in M3 CSV-volledigheidsgate voor scripts

De M3-veld-CSV-review uit [product PR #1163](https://github.com/Zennay/Supa/pull/1163) geeft standaard een JSON-rapport met volledigheid en neutrale waarschuwingen. De oorspronkelijke één-argument-oproep blijft achterwaarts compatibel en stopt bij een **goed gevormd maar leeg/onvolledig CSV-bestand met code 0**.

Wie de preflight in een shellscript gebruikt en wil dat *onvolledige* regels niet als succesvol worden gezien, kiest **expliciet** de nieuwe gate:

```sh
node --experimental-strip-types scripts/m3-review-field-csv.mjs --require-complete /private/m3-observations.csv
```

## Exitcodecontract

- **0**: CSV is structureel compleet volgens de lokale, optionele preflight. Outputstatus: `requires-canonical-human-verification`. Dit is **geen** goedgekeurde retailerbron, bewezen veldobservatie, release of besparingsclaim.
- **2**: CSV kon gelezen en beoordeeld worden maar is leeg, onvolledig of heeft een waarschuwing (`incomplete-or-needs-review`). De machinevriendelijke JSON blijft op stdout staan zodat de operator geaggregeerde voortgang ziet.
- **1**: Ongeldige CLI-argumenten, CSV-structuur, onleesbare lokale input, symlink en vergelijkbare technische invoerfouten. Alleen een algemene foutregel verschijnt op stderr; geen product-, prijs-, bron-URL-, opmerking- of bestandsnaamvelden.

Zonder `--require-complete` blijft de oorspronkelijke één-argument-review gelijk; opt-in gedrag mag bestaande gebruikers niet verrassen. De invoer wordt niet aangepast, er is geen netwerkverzoek en er wordt geen retailerdata opgeslagen of gereconstrueerd.

De menselijke [M3-veldmeting #78](https://github.com/Zennay/Supa/issues/78), de origineel vastgepinde code-revisie, onafhankelijke broncontrole, vergunningen/privacy en de canonieke observation JSON + converter + assessment blijven verplicht. Zelfs alle **22 synthetisch volledig ingevulde rijen** geven `evidenceVerified:false`, `releaseEligible:false`, `claimable:false`, `savingsCents:null`.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** tot exact-head CI, passende VPS/M3-gates en oorspronkelijke eigenaaracceptatie.
