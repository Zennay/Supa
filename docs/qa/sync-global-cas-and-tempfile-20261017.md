# SUPA synchronisatie — globale revisie en tijdelijke-bestandsintegriteit (QA 17 okt 2026)

**Dit is een onafhankelijke testhandoff op DRAFT product [#3777](https://github.com/Zennay/Supa/pull/3777), geen gerealiseerde productiecorrectie.** Alle tests gebruiken eigen tijdelijke directories, fictieve apparaatsleutels en synthetische plannerinstellingen. Geen echte klanten, winkelprijzen, externe HTTP, VPS-mutaties of publieke besparingsclaims.

## Exacte fout op GitHub-hosted Node

De bron `server/sync-store.mjs` deelt zijn in-memory `queues` Map **niet** met een tweede `createFileSyncStore({dir})`-instantie op dezelfde opslagdirectory. Dezelfde code construeert tijdelijke bestanden als `<hash>.json.<process.pid>.<Date.now()>.tmp`. Bij simultane onafhankelijke schrijvers ontbreekt dus een gedeelde atomic compare-and-swap (CAS) en kunnen tempnamen botsen.

- Oorspronkelijke add-only QA: [DRAFT PR #3788](https://github.com/Zennay/Supa/pull/3788), SHA `6e450fe7d764106f0835e4ca779ad61a1f179353`. [GitHub-native CI #39015866903](https://github.com/Zennay/Supa/actions/runs/39015866903), job `117347729453`, **3.243/3.245 Node PASS; exact twee RED** in aparte store-instanties wegens identieke tempnaam met `ENOENT rename`. De seriële positieve controle ging GREEN.
- Extra add-only echt HTTP-scenariotest, uiteindelijke onafhankelijke SHA `2b6711cc56faf402e77473114436f5d2f70a9643`: [CI #39016299060](https://github.com/Zennay/Supa/actions/runs/39016299060), job `117349247291`, **3.243/3.246 Node PASS; exact drie eigen RED**. De log laat tevens **twee succesvolle commits op dezelfde revisie** zien (de ene overschrijft potentieel de andere), `ENOENT` bij andere gelijktijdige schrijfacties, en bij twee echte lokale HTTP-servers op dezelfde directory status **200+500** in plaats van de overeengekomen **200+409**. Geen andere fouten, skip, cancel of todo.
- Beide oorspronkelijke volledig gehoste logs gecontroleerd. `npm ci` en `npm audit --audit-level=high` GREEN; matchingbenchmark, daadwerkelijke bronrechtencheck en TS/Vite-build **niet gedraaid** na de doelbewuste test-RED. Deze failing CI is expliciet niet gelijk aan productieklare veiligheid.

## Product-owner herstelcontract

Alleen de exclusieve eigenaar van de actieve source-PR mag `server/sync-store.mjs` en deployment semantics herstellen. Beslis **vooraf** of gedeelde filesystem-opslag tussen meerdere processen/servers ondersteund wordt. Voor single-instance-only: ontwerp een afdwingbare singleton deployment/deployment-health check en bewaak gebruik van dezelfde data directory; weliswaar voorkomt dat de globale CAS-complexiteit, maar het maakt data uit twee onafhankelijke instanties niet veilig zodra die toch ontstaan. Voor daadwerkelijk multiple processes/instances: bied één shared transaction lock/CAS over de huidige revisie en de nieuwe atomisch gepubliceerde record; gebruik unieke `O_EXCL` tempbestanden, correcte crash cleanup en idempotentie, en laat de loser een echte **409 Conflict** zien met de *huidig opgeslagen* revisie. **Unieke tempnamen zonder gedeelde revisiecontrole verhelpen de stille overwrite niet.**

Acceptatie zonder afgezwakte tests:
1. Originele twee QA-bestanden uit PR #3788 onveranderd replayen, zowel direct store op rev0/rev1 als 2× lokale HTTP-server; precies één winst + één 409 conflict, geen HTTP 500 / ENOENT en de opgeslagen record exact gelijk aan de enige erkende winnaar.
2. Daarna native volledige `npm ci`, high audit, `npm test`, M1 matching, **werkelijke** bronrechtencontrole met `productionReady:false`, TS/Vite-build op exact eigenaar-head.
3. DRAFT/NONMERGE tot bevoegde zCloud scoped writer- en beschermde-main mergelease. Geen claim dat echte winkelbezoeken of klantdata al zijn gevalideerd.

Gerelateerde eigenaarstaak: [P1 #3790](https://github.com/Zennay/Supa/issues/3790) en [Notion werkvoorraad](https://app.notion.com/p/3fc9e19ac95581d9b9feeb00d82caa68). Supa blijft M3 HOLD wegens afzonderlijke schriftelijke retailerrechten [#74](https://github.com/Zennay/Supa/issues/74), echte menselijk gepaarde 11×2 veldmanden [#78](https://github.com/Zennay/Supa/issues/78), veldcode-SHA [#205](https://github.com/Zennay/Supa/issues/205) en permanente runner [#2833](https://github.com/Zennay/Supa/issues/2833).
