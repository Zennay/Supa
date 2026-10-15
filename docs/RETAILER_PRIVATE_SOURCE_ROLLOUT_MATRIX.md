# SUPA — offline PLUS/DekaMarkt uitrolmatrix (P1)

Deze product-core CLI laat **in één commando** zien welke bestaande PLUS- en DekaMarkt-adapters historisch geteste bronvormen hebben en wat er per keten nog ontbreekt. Ze combineert de daadwerkelijke zes versiegebonden M1-fixtures, de bestaande gevalideerde adaptergezondheid en de canonieke bronrechtenregistratie.

```bash
node --experimental-strip-types scripts/retailer-private-source-rollout-matrix.mjs
node --experimental-strip-types scripts/retailer-private-source-rollout-matrix.mjs --at 2026-10-05T00:00:00.000Z
node --experimental-strip-types --test tests/product-retailer-private-source-rollout-matrix-20261015.test.mjs
```

De optionele `--at`-datum is een **auditklok voor historische fixtures**, niet het tijdstip van een nieuwe opname. Zonder optie gebruikt de CLI het huidige tijdstip. De output bevat voor beide winkels en elk van de drie vormen (`product`, `catalog`, `offers`) de bron-aantallen, afgekeurde records, onvolledige vormen en oude captures. `historical-fixture-present` betekent alleen dat de oorspronkelijke offline bron ooit door de lokale parser is geaccepteerd. `archived-capture-outside-review-window` betekent dat deze opname bij de gekozen auditklok ouder dan 24 uur is. **Beide uitkomsten betekenen nul actuele prijsdekking.**

De bronrechten worden *niet* uit heuristieken afgeleid. De CLI valideert de bestaande `evidence/m1/source-permission-gate.v1.json` met `evaluateSourcePermissionGate`. Zoals dat register nu staat, is PLUS `permission_required` en DekaMarkt `unresolved`. Onjuiste of tegenstrijdige metadata wordt geweigerd, niet als geautoriseerde bron geïnterpreteerd. Het verslag noemt gerichte vervolgacties zoals schriftelijke toestemming, ontbrekende source shapes en historische freshness.

De CLI doet **geen netwerk-, browser-, proxy- of winkelverzoek**, kan geen willekeurige input-URL of bestandsmap ontvangen, wijzigt geen manifest, activeert geen scheduler en presenteert nooit individuele productprijzen/URL's/identiteiten. Alle uitvoer heeft `liveRetailerRequests: 0`, `scheduledRefreshEnabled: false`, `productionEnabled: false` en `publicSavingsClaimEligible: false`. Zelfs een complete historische matrix plus later toegekende rechten is **geen automatische productie-release**.

Voor echte uitrol blijven afzonderlijk nodig: een aantoonbare retailer-specifieke geschreven licentie/toestemming (#74), een nieuwe expliciet geautoriseerde capture/selector-validatie met echte historische en verse SHA-gebonden bestanden, officiële source/robots-beoordeling, trusted runner en lease, en de menselijke gelijkwaardige PLUS/Deka 11×2 veldmeting binnen 24 uur (#78) met echte field-codepin (#205). Geen fictieve prijzen of vervanging van deze bewijsstappen.
