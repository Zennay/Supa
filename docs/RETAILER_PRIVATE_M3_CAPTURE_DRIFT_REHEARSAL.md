# Supa — privé M3 bronarchiefvergelijking (product-core, 16 oktober)

## Wat dit echte onderdeel doet

De bestaande [M3-ingestiepreflight](../scripts/retailer-private-m3-ingestion-preflight.mjs)
controleert één archief met zes PLUS/DekaMarkt product-/catalogus-/aanbiedingsbronnen.
De nieuwe **drift rehearsal** leest **twee** door een operator al goedgekeurde
en met SHA-256 vastgepinde privé-archiefmappen, en laat beide apart dezelfde
integriteits-, rechten-, tijd-, verpakkings-, aanbiedingen- en voorraadcontroles
doorlopen.

Het resultaat toont per winkel × bronsoort uitsluitend **totalen** van
gewijzigde historische gegevens en signalen voor menselijke controle.
De broncode vergelijkt alleen *historische offline vastgelegde waarnemingen*,
en beweert **niet** dat een winkel vandaag iets verkoopt, een prijs heeft
veranderd, een product uit het assortiment heeft gehaald of korting geeft.

## Uitvoeren (alleen bestaande, eerder beoordeelde gegevens)

De mappen worden gemaakt via
[`retailer-private-reviewed-manifest-builder.mjs`](../scripts/retailer-private-reviewed-manifest-builder.mjs),
waarna de oorspronkelijke manifesten en de 6–32 bronbestanden 0600
en de mappen 0700 blijven. Voor elke map zijn alle zes PLUS/Deka
bronsoorten verplicht. De rehearsal maakt **nooit zelf** een archief.

```bash
node --experimental-strip-types scripts/retailer-private-m3-capture-drift-rehearsal.mjs \
  --before-dir /private/baseline \
  --after-dir /private/candidate \
  --at 2026-10-15T10:00:00.000Z
node --experimental-strip-types --test tests/product-retailer-private-m3-drift-rehearsal-20261016.test.mjs
```

Alle gebruikte archieven en fixturebestanden worden alleen-lezen geopend
met bestaande nofollow, SHA- en bestandsrechtencontroles. Bronnen met
gewijzigde bytes, ontbrekende capture, vervalste metadata of onveilige JSON
worden afgewezen; het CLI-programma retourneert daarbij uitsluitend
`Private M3 retailer drift rehearsal refused` en statuscode 2.

## De daadwerkelijke controle

1. Elk archief apart door de echte SHA-256 manifest replay en de volledige
   geïntegreerde [M3 ingestiepreflight](../scripts/retailer-private-m3-ingestion-preflight.mjs).
   De oorspronkelijke bronrechten zijn nog steeds **niet** gevalideerd voor
   hergebruik; alle reguliere capture- en publicatieschakelaars blijven uit.
2. Alle twee historische datasets gaan door de bestaande, complete
   [bronfeitvergelijking](../scripts/retailer-private-fact-change-review.mjs).
   Een gelijkwaardige SHA+URL mag niet nieuwe productfeiten fabriceren;
   onvergelijkbare/teruggedraaide producttijdlijnen worden geweigerd.
   Ook op **dezelfde fysieke captuurtijd** mag de oorspronkelijke
   SHA/bron-URL niet verschillen, zelfs wanneer alle product-ID's van een
   HTML-pagina plots anders zijn. Dat is een onbewijsbare broncontinuïteit,
   geen geldige "nieuw assortiment"-waarneming.
3. Aanvullend: ook de **laatste fysieke tijd per bronsoort** mag nooit teruglopen,
   zelfs wanneer alle product-ID's anders zijn (dan zou een gewone
   productvergelijking geen overlappende producten zien). Timestampafstanden
   worden tot nanoseconden vergeleken.
4. Historische aantallen per PLUS/Deka bronsoort worden samengevat voor
   toegevoegd/ontbrekend/gewijzigd, meer onbekende of niet-beschikbare
   voorraad, en toegenomen verouderde of afgekeurde opnames.
   Onderscheid **geen nieuw archiefprobleem** van **klaar voor productie**:
   ook bij geen enkele afwijking blijft `releaseDecision:"hold"`.

## Wat dit bewust niet doet

- Geen HTTP-verkeer, browser, API, retailerpagina of credentials.
- Geen scheduler, live scrape, winkelwagenvergelijking, automatische
  deployments of externe rechtenverklaring.
- Geen individuele URL, SHA, SKU, productprijs, klantgegevens of lokaal
  privépad in stdout/stderr of geaggregeerde melding.
- Geen automatische goedkeuring als bronheffing ongewijzigd lijkt.

Een leeg afwijkingsrapport is alleen bewijs dat **de twee door de mens
geselecteerde historische datasets in de beoordeelde aspecten overeenkomen**,
niet dat supermarktprijzen actueel, beschikbaar of toegestaan zijn.

## Nog op te heffen M3-blokkades

Schriftelijke bronhergebruiksrechten [#74](https://github.com/Zennay/Supa/issues/74),
echte 11 PLUS + 11 DekaMarkt identieke mandobservaties binnen 24 uur
[#78](https://github.com/Zennay/Supa/issues/78), daadwerkelijke
veldcode-pin [#205](https://github.com/Zennay/Supa/issues/205) en permanente
betrouwbare runner [#2833](https://github.com/Zennay/Supa/issues/2833).
Geen enkele van die grenzen wordt door deze historische vergelijking
opgelost of omzeild.
