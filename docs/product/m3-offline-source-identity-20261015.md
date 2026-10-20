# M3 offline bronidentiteit — product-core herstel #2836

De reeds legaal verkregen HTML wordt uitsluitend **offline** gelezen. Voor validatie van de pagina maakt de parser één onveranderlijke kopie van de expliciete eigen `kind`, `supermarket` en `url` gegevens. Hij hergebruikt precies die gevalideerde kopie voor broncontrole én Schema.org-productselectie.

- Dynamische getters, Proxy-traps, geërfde of extra/symbolische velden en malforme stringtypes worden vóór verdere bronverwerking geweigerd.
- Een echte gewone bron met exact drie eigen stringvelden blijft toegestaan voor PLUS of DekaMarkt, uitsluitend op de strikte HTTPS-productroutes.
- De parser doet **geen** netwerkverzoeken en herinterpreteert geen omzet/voorraad/checkoutgegevens als echt bewijs.
- De bestaande 2 MiB HTML, 256 KiB per JSON-LD script, maximaal 100 JSON-LD scripts en product-ambiguïteitsgrenzen blijven onveranderd.

Dit product-core werk reageert op [issue #2836](https://github.com/Zennay/Supa/issues/2836) en wordt onafhankelijk getest door [QA #2835](https://github.com/Zennay/Supa/pull/2835). Ook na groene tests is de uitkomst een **privé preview**, niet een besparingsclaim. M3 vraagt nog altijd om echte PLUS11 + Deka11-meting [#78](https://github.com/Zennay/Supa/issues/78), schriftelijke rechten [#74](https://github.com/Zennay/Supa/issues/74), én geverifieerde study-code-pin integratie [#205](https://github.com/Zennay/Supa/issues/205). Geen merge of deploy zonder toepasselijke scoped zCloud-write-lease, owner-review en CI/VPS-gates.
