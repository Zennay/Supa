# Supa — bronintegriteit bij offline historische prijs-/voorraadvergelijkingen

De zes historische PLUS/DekaMarkt-adapters leveren genormaliseerde review-only productgegevens plus URL, SHA-256 en oorspronkelijke capturetijd. Deze brongegevens dienen één op één te blijven: **identieke ruwe bytes van exact dezelfde URL bij hetzelfde product mogen niet ineens andere naam-, prijs-, voorraad-, verpakking- of aanbiedingsfeiten betekenen omdat de capturetijd verspringt.**

De private fact-change API vergelijkt daarom voor overeenkomende `retailer:kind:productId` observaties met eenzelfde `provenance.sha256` en URL alle feitelijke genormaliseerde productvelden, **uitgezonderd alleen de capturetijd**. Tegenstrijdige productfeiten leiden tot een veilige weigering, niet tot een onjuiste historische wijzigingsmelding. Een werkelijk afwijkende source SHA mag wél een private feitenwijziging opleveren, maar nooit live prijzen of publicatiegoedkeuring.

De originele test van QA [PR #3060](https://github.com/Zennay/Supa/pull/3060) is byte-identiek opgenomen zonder hun branch aan te passen: twee positieve controles en twee voordien gehoste RED-gevallen voor prijs- en voorraadverandering onder gelijkblijvende bronbytes. De nieuwe eigen producttests voegen verpakkings-/naamfeiten, gewijzigde bron-SHA, alleen latere nanoseconde-capture en de zes ongewijzigde historische M1-bronvormen toe.

`node --experimental-strip-types --test tests/qa-retailer-same-sha-fact-consistency-independent-20261015.test.mjs tests/product-retailer-same-sha-fact-immutability-20261015.test.mjs`

Rechten blijven ongewijzigd: PLUS permission_required en DekaMarkt unresolved, geen echte winkelrequest, geen levende prijs, geen publieke besparingen. Voor M3 release blijven schriftelijke bronrechten #74, identieke menselijke 11+11 binnen 24 uur #78, echte field SHA #205 en trusted VPS gate #2833 nodig.
