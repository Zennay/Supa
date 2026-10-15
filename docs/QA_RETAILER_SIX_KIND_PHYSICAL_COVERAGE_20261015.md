# Supa — structurele dekking van elke private SQLite capture

## Aanvulling op de bestaande zes-bronnentoets

De bestaande preflight `scripts/qa-retailer-sqlite-six-kind-preflight.py`
controleerde zes combinaties van keten en bronsoort (PLUS/DekaMarkt ×
product/catalogus/aanbieding), geldige historische bronmetadata, minimaal één
waarneming **per bronsoort**, productaantallen en alle publicatierechten op
`false`/niet-geautoriseerd.

Die controle volstond niet voor een database waaraan ongemerkt een **extra
sourcesnapshot zonder waarneming** of een **extra product zonder bronregel**
was toegevoegd. De totalen leken nog correct en de reeds aanwezige zes
bronsoorten bleven gevuld. Ook een willekeurige zesde metadata-sleutel
kon worden aangezien voor onderdeel van het private schema.

## Nieuwe invariante bronketen

- Ieder fysiek `source_snapshots.id` uit de gecontroleerde bronset is
  daadwerkelijk gekoppeld aan ten minste één `price_observations`-rij.
- Ieder fysiek `products.(retailer_id, source_product_id)` is daadwerkelijk
  door ten minste één prijswaarneming ondersteund (ook als het bedrag
  onbekend/null is; **onbekend is nooit nul**).
- Metadata bevat precies de vijf schema-v1 privacysleutels, zonder
  toegevoegde autorisatie- of permissieclaims.
- Een **extra, structureel geldige zevende historische capture** met een
  fysieke gekoppelde waarneming blijft mogelijk; deze controle eist
  zes **soorten**, niet exact zes captures voor altijd.

## Replay

```sh
node --experimental-strip-types --test \
  tests/qa-retailer-six-kind-physical-row-completeness-20261015.test.mjs
```

De tests gebruiken alleen een nieuwe, lokale 0600 database uit zes
reeds beoordeelde fixturebestanden, en muteren afzonderlijke disposable
kopieën. Ze controleren correcte 6/13/16 basis, weigering van een lege
extra snapshot, een verweesd product en extra metadata, plus een
afzonderlijk synthetisch geval 7/13/17 waarin de extra snapshot wél
een fysieke gekoppelde observatie heeft.

Deze 7/13/17 **structurele test is geen bewijs dat een echte retailerpagina
meermaals is bezocht**: alleen databaseconsistentieregels worden getest.
Voor een claim dat bytes en prijzen overeenkomen met echte historische
bronfixtures is de strengere exact-source-check verplicht:
`scripts/qa-retailer-reviewed-db-exact-parity.mjs`.

Op iedere onvolledigheid: generieke stderr, exit 2, **lege stdout**,
geen productgegevens, prijzen, bron-URL's of private bestanden.
Geen netwerkrequests of scraping, geen toestemming of productie-publicatie.

M3 blijft afhankelijk van echt 11×PLUS + 11×DekaMarkt veldbewijs
[#78](https://github.com/Zennay/Supa/issues/78),
retailerrechten [#74](https://github.com/Zennay/Supa/issues/74),
code/source-SHA [#205](https://github.com/Zennay/Supa/issues/205)
en permanente VPS-validation [#2833](https://github.com/Zennay/Supa/issues/2833).
