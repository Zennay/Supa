# M3 veld-CSV: verpakkingseenheden (product-core, concept)

Deze opt-in controle is een uitbreiding op de bestaande, **niet-bewijskrachtige** ingevulde CSV-preflight uit product PR #1163 en gebruikt dezelfde hoeveelheidsfamilies als de M2 matching-engine.

## Wat de controle wel doet

- Bij **beschikbaar = ja** hoort de verpakkingshoeveelheid bij dezelfde soort grootheid als het ingredient: gram/kilogram (massa), milliliter/liter (volume), of stuk (aantal).
- `g` en `kg` zijn onderling compatibel; `ml` en `l` ook. Een hoeveelheid in `g` kan **niet** worden afgehandeld met `ml`, of andersom. `piece` kan alleen met `piece`.
- Een verpakking die in `piece` is beschreven heeft een **positief, veilig geheel aantal stuks** (geen 0,5 stuks). Massa en volume mogen wel een decimale hoeveelheid hebben.
- Een onjuiste combinatie krijgt uitsluitend de neutrale `incompatible-pack-unit` waarschuwingscode. De betreffende rij telt niet mee als compleet.
- Expliciet niet-beschikbare producten hebben geen verpakkingsgegevens nodig en geven dus niet vanwege hun lege eenheid een fout.

## Wat de controle bewust niet doet

- **Niet** eisen dat één verpakking genoeg is voor de volledige ingredientvraag. Een winkelmand mag later twee zakken van 500 g kopen om aan 1 kg te komen. `pack_count` beschrijft de inhoud/multipliciteit van het geobserveerde product, niet het aantal af te rekenen SKU-verpakkingen.
- **Geen** berekening van daadwerkelijke boodschappenmand, benodigde aankoopverpakkingen, prijsvergelijking, besparing of beschikbaarheidsovername. Dat blijft de taak van de canonieke M3 JSON-verwerking en menselijke beoordeling.
- **Geen** geobserveerde winkelprijzen, consumentgegevens of licenties fabriceren; de tests gebruiken fictieve waarden.

Het resultaat `requires-canonical-human-verification` blijft ook na deze unitcontrole expliciet **geen** bewijs: `evidenceVerified:false`, `releaseEligible:false`, `claimable:false`, `savingsCents:null`. De echte PLUS-baseline en DekaMarkt-kandidaat voor dezelfde 11 ingredienten binnen 24 uur moeten apart worden vastgesteld via [issue #78](https://github.com/Zennay/Supa/issues/78).

**DRAFT / HOLD / NO MERGE / NO DEPLOY** totdat de exacte CI, relevante permanente VPS-controles, oorspronkelijke #1163/#1162/M3-eigenaren en veilige integratie akkoord zijn.
