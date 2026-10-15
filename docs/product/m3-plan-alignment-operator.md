# M3 veldweek-voorcontrole — vóór een echte 11×2 winkelmeting

De **Meten**-werkbladen zijn bevroren op vier specifieke recepten en elf identieke ingrediënten per winkel. Een gepersonaliseerde Planner-week is niet automatisch deze vaste onderzoeksweek. Voorkom dat een operator per ongeluk een aangepaste boodschappenmand als de vaste onderzoeksmand behandelt.

## Uitvoeren (lokaal, volledig offline)

Vanaf de repository-root op een computer met Node:

```sh
node --experimental-strip-types scripts/m3-field-plan-alignment.mjs
node --experimental-strip-types scripts/m3-field-plan-alignment.mjs --days Do,Wo,Di,Ma
node --experimental-strip-types scripts/m3-field-plan-alignment.mjs --plan Ma:tikka,Di:teriyaki,Wo:pasta,Do:tikka
```

Alle drie moeten `fixedStudyWeekMatches:true` retourneren. De exacte volgorde van dagen is niet belangrijk; **alle vier dagen met hun oorspronkelijke recepten zijn verplicht**.

De volgende gecontroleerde *demovarianten* stoppen een vaste veldmeting:

```sh
node --experimental-strip-types scripts/m3-field-plan-alignment.mjs --days Ma,Di
node --experimental-strip-types scripts/m3-field-plan-alignment.mjs --plan Ma:pasta,Di:teriyaki,Wo:pasta,Do:tikka
```

Voor beide geeft het commando `fixedStudyWeekMatches:false`, `matchesFixedWorksheetDemand:false` en een leesbare reden (`missingDays` of `changedRecipes`).

## Automatische exitstatus

- **0** — gekozen demo-planning is dezelfde fysieke vaste onderzoeksweek; dit is *alleen* een planningscheck.
- **3** — planning wijkt af; **stop**, gebruik de vaste 11×2-veldformulieren niet voor die aangepaste planning.
- **2** — ongeldige/incomplete CLI-invoer; geen output met ruwe argumenten of persoonlijke waarden.

Ook bij een geslaagde controle blijven `retailerReusePermissionVerified:false` en `fieldObservationEvidenceCollected:false`. Een match is **geen toestemming** om bronnen te hergebruiken en geen bestaand veldbewijs.

De output bevat alleen gecontroleerde fictieve dag-/recept-ID's, verwachte winkelmerken, en een waarschuwing. De CLI leest geen lokale Planner-opslag, echte deelnemersgegevens of ingevulde observatiebestanden, stuurt geen HTTP-verzoeken en maakt geen winkelprijzen, besparingen of toestemming aan. Gebruik geen echte persoons- of bron-URL's als argument.

## Na een geslaagde voorcontrole

1. Voer de eigenlijke **echte handmatige** PLUS- en DekaMarkt-metingen van de identieke elf ingrediënten uit, in één regio en dezelfde prijscontext, binnen **24 uur** (issue [#78](https://github.com/Zennay/Supa/issues/78)).
2. Leg bron, echte waarneming, tijdzone en de werkelijk gebruikte **main code-SHA** vast; er mag nooit een ontbrekende veld-SHA worden gegokt ([#205](https://github.com/Zennay/Supa/issues/205)).
3. Schriftelijke databronrechten van PLUS/DekaMarkt ([#74](https://github.com/Zennay/Supa/issues/74)), onafhankelijke acceptatie en volledige permanente VPS-gates blijven afzonderlijk vereist.
4. Een succesvolle voorcontrole betekent **niet** dat er echte prijzen zijn gemeten of dat een besparing publiek geclaimd mag worden. De uitvoer heeft `evidenceStatus:preflight-only-not-an-observation` en `publicSavingsClaimEligible:false`.

Deze tool verandert het bestaande gebruikersformulier, de vaste fysieke vraag of echte observaties **niet**; hij is alleen een extra offline operator-veiligheidsstap, niet een nieuwe studie.
