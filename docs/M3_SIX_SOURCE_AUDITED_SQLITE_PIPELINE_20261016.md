# SUPA M3: zes echte historische supermarktbronvormen tot gecontroleerde privé-database

**Status:** product-core integratie van de bestaande gehoste maar nog niet gemergede PLUS/DekaM3-engine, de bronveiligere directe SQLite importer en de onafhankelijke read-only audit. Dit is een ontwikkelhulpmiddel, **niet** een live prijsdatabase.

## Eén uitvoerbaar commando (Node 22+ en Python 3)

```sh
node --experimental-strip-types scripts/retailer-private-six-source-integrated-audit.mjs --out /private/lokaal/reviewed.sqlite
```

Het commando laadt uitsluitend de zes echte eerder in de repo bewaarde, gesaniteerde en gereviewde PLUS/Deka historische bronvormen (product, catalogus en aanbieding per winkel). Het hergebruikt de oorspronkelijke adapter-health en bounded-cataloguscontrole en beoordeelt de canonieke **11 weekbehoeften × 2 winkels = 22 beoordelingsregels**, voordat de SQLite-builder een nieuw exclusief **0600** bestand maakt. Vervolgens controleert `retailer-audit-private-sqlite.py` read-only de **daadwerkelijk opgeslagen** zes bronvormen, herkomst, fysieke relaties en blijvende denied bronrechten.

**Normale stdout:** één klein JSON-object met aantallen, `physicalDatabaseIntegrityVerified:true`, `twoStoreReviewRows:22`, `releaseDecision:"hold"`, `actualRetailerPricesVerified:false`, `sourceRightsVerified:false`, `publicSavingsClaimEligible:false`. Nooit losse productnamen, URLs, eenheidsprijzen, SHA's, gebruikersinformatie of outputpad.

**Foutgedrag:** bij ontbrekend/verkeerd CLI-argument, slechte bron, bestaande doeldatabase, symlink-ouder, onveilige database of mislukte audit is de exitcode 2, stdout leeg en alleen een vaste foutmelding op stderr. Bestaande gebruikersbestanden mogen nooit worden overschreven. Als de aparte audit na de builder faalt, kan een **nieuw gemaakte privédatabase** blijven staan voor handmatige forensische inspectie; het commando maakt geen succesvolle rapportage en verwijdert de mogelijk relevante brondata niet stilzwijgend.

Het samengestelde product is getest met een daadwerkelijk aangemaakte SQLite en een tweede los Python-proces dat de rijen controleert, plus regressies voor bestaande database, malformed flags, no-output en Proxy-input. De oorspronkelijke QA van acht aangetoonde directe Python fouten (credentials, 1ns aanbod en symlink voorouders) staat byte-identiek in deze integratietak.

## Wat niet bewezen is

Deze pipeline controleert **historische opslag, niet actuele supermarktprijzen, kassabonnen, hergebruiklicenties of echte besparingen**. De fysieke veldmeting [#78](https://github.com/Zennay/Supa/issues/78), schriftelijke rechten [#74](https://github.com/Zennay/Supa/issues/74), bron/code-SHA [#205](https://github.com/Zennay/Supa/issues/205), permanente M3 VPS [#2833](https://github.com/Zennay/Supa/issues/2833) en geautoriseerde exclusieve zCloud main writer lease blijven buiten het commando vereiste HOLD-gates. Geen externe fetch, live scraping, proxy/CAPTCHA-bypass, scheduler of publicatie.
