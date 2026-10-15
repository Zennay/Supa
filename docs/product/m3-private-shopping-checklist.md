# SUPA — privé supermarktchecklists

De checklists tonen de concrete hele verpakkingen die bij elk van de twee winkels nodig zijn om **dezelfde** ingrediëntvraag te dekken. Ze vormen een leesbaar overzicht van de bestaande M3-vergelijkingsengine, geen nieuwe scraper en geen gecontroleerde live prijs.

```bash
node --experimental-strip-types scripts/retailer-private-shopping-checklist.mjs pad/naar/manifest.json
```

Per winkel wordt een product maximaal eenmaal als betaalde aankoop getoond. Wanneer twee ingrediënten hetzelfde fysieke pak delen, staat bij de tweede regel **gedekt door eerder gedeeld pak**, niet *gratis*. Onbekende voorraad, ontbrekend product, onbetrouwbare stuksprijs of foutieve winkeloptelsom leiden tot **geen betrouwbaar volledig totaal**. Productnamen worden ontdaan van terminalopmaak en source-URL geheimen worden nooit afgedrukt.

Dit is een **privé offline** hulpmiddel. Ook een vollediger bronoverzicht is geen toestemming om PLUS of DekaMarkt te scrapen of bedragen als echte besparing te presenteren. Voor M3-release blijven [echte 11+11 identieke boodschappenmand (#78)](https://github.com/Zennay/Supa/issues/78), schriftelijke datarechten, owner reviews, scoped zCloud-lease en permanente runneracceptatie vereist.
