# SUPA: veilige autorisatie bij een **rechtstreekse** één-pagina-opname

De eerdere fix in de selectorbrug beschermt alleen aanroepen die via die brug verlopen. De openbare, herbruikbare `captureApprovedRetailerPage` kan ook rechtstreeks door een andere adapter of workflow worden aangeroepen. Dit product-core werk sluit daar dezelfde toestemmingstruc af.

**Wat wijzigt:** vóór zelfs een mogelijke aanroep van de geïnjecteerde `fetchFn` worden de brongegevens, één-URL-toestemming en volledige retailerrechtenregistratie uitsluitend via eigen dataproperty-descriptors opgevraagd. Geneste getters, setters, Proxies, sparse arrays en niet-gewone objecten worden geweigerd. De input wordt tot een losgekoppelde, eindige kopie opgebouwd; latere wijzigingen in objecten van de caller kunnen de geregistreerde bronsoort, URL of capturerechten van de lopende aanvraag niet stilzwijgend veranderen.

De oorspronkelijke inhoudelijke controles blijven onveranderd: PLUS en DekaMarkt zijn standaard niet toegestaan volgens `evidence/m1/source-permission-gate.v1.json`, HTTPS/route/robots-grant blijft verplicht en 403/429 wordt niet via retries of proxies omzeild. Er is geen standaard netwerkfunctie, CLI, scheduler of live capture geactiveerd.

De nieuwe directe API-regressies gebruiken uitsluitend in-memory `Response` en **fictieve toestemming**. Ze bewijzen dat de echte rechtenregistratie vóór transport blijft blokkeren, getters/Proxies niet worden uitgevoerd, gewone synthetische positieve opnames nog kunnen werken, en een mock transport dat daarna het oorspronkelijke callerobject wijzigt de SHA-gebonden provenance niet kan vervalsen.

Reproduceerbaar: `node --experimental-strip-types --test tests/product-retailer-direct-capture-inert-authorization-20261015.test.mjs`.

Deze producthardening schept geen echte retailerrechten (#74), geen menselijke M3-metingen (#78), geen veldcodepin (#205) en geen trusted runner (#2833). Alle records en dataverzoeken blijven offline/in review tot separate goedkeuring.
