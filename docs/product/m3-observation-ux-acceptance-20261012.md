# M3 Meten — product-core acceptatiecontract (12 oktober 2026)

Status: **DRAFT / HOLD**. Dit document is een additieve productspecificatie, geen veldbewijs, release of wijziging aan de actieve ObservationView-owner.

## Gebruikersdoel
Een medewerker kan voor dezelfde boodschappenbehoefte bij PLUS en DekaMarkt handmatig een verifieerbare observatie vastleggen, zonder dat ontbrekende prijzen als besparing worden gepresenteerd.

## UI-contract
1. Toon de benodigde hoeveelheid in het Nederlands: `nodig: 1 stuk`, `nodig: 2 stuks`; een onbekende, niet-eindige of negatieve hoeveelheid toont `nodig: ? stuks`.
2. In de eenhedenkeuze wordt `stuk` getoond, maar de opgeslagen waarde blijft `piece`. Vertaling mag geen schemawijziging veroorzaken.
3. Toon bij beide winkels dezelfde canonieke vraagregel, hoeveelheid en eenheid. Geen stilzwijgende afronding van fracties.
4. Markeer ontbrekende observaties expliciet als **niet beschikbaar** of **nog niet gemeten**; onderscheid die twee toestanden.
5. Toon bij onbekende prijzen geen totaalbesparing, geen nulbedrag als fallback en geen publieke besparingsclaim.
6. Maak bron, observatiemoment, winkelidentiteit en verpakkingshoeveelheid zichtbaar vóór bevestiging; bewaar persoonlijke veldnotities niet in publieke rapportage.
7. Als een observatie wordt aangepast, laat de gebruiker het verschil controleren voordat deze wordt opgeslagen.

## Acceptatie voor eigenaar van ObservationView
- Render de echte ObservationView, niet alleen een los helpercomponent.
- Controleer Nederlandse labels voor beide winkels met een lege 11+11-mand.
- Controleer de `stuk`-optie in de echte selector en dat submit nog `piece` oplevert.
- Controleer onbekend/negatief, nul, enkelvoud, meervoud en fracties.
- Controleer toetsenbordnavigatie, zichtbare labels en foutmeldingen zonder kleurafhankelijkheid.
- Controleer dat onvolledige mandjes nooit een financieel voordeel claimen.
- Gebruik uitsluitend synthetische fixtures totdat de menselijke M3-veldwaarneming (#78) werkelijk is uitgevoerd.

## Integratievoorwaarden
De bestaande eigenaar van `ObservationView.tsx` (#522) beslist over code-integratie. Verifieer eerst zCloud preflight/claim/lease, laatste main, exact-head CI en toepasselijke Firefox/mobile/VPS-gates. Zonder die controles: **niet mergen, niet deployen**.
