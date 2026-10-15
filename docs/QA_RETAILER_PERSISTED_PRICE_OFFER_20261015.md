# Supa QA — bewaarde prijzen, verpakkingen en aanbiedingen controleren

Deze add-on versterkt de **private, offline** zes-bronnen-toelatingstoets, zonder prijzen of aanbodclaims te publiceren.

## Waarom een SQL CHECK niet genoeg is

De importer weigert onveilige bedragen, onmogelijk grote hoeveelheden en ongeldige datums vóór opslag. Maar later gewijzigde SQLite-rijen kunnen zulke velden terugbrengen, terwijl alle bronsoorten aanwezig blijven.

De onafhankelijke read-only `qa-retailer-sqlite-six-kind-preflight.py` valideert nu ook de fysiek bewaarde observaties:

- `price_cents`, `offer_price_cents`, `original_price_cents`: alleen null of veilige hele centen (0 t/m 9.007.199.254.740.991). Geen floats, negatieve of te grote bedragen.

- `pack_amount`: null of eindig, groter dan 0 en kleiner dan 1e12. `pack_text`: maximaal 256 tekens. Verpakkingseenheid, valuta en beschikbaarheidsstatus blijven canoniek.

- Zonder aanbiedingsnaam zijn er geen kortingvelden. Een aanwezige naam is niet-leeg en beperkt.

- Aanbiedingsdatums hebben een volledige echte ISO-kalenderdatum en tijdzone, met maximaal ±14 uur offset en een niet-omgekeerd interval. In deze historische schema-v1 pilot worden datums in de toekomst geweigerd.

## Offline controle

```sh

node --experimental-strip-types --test tests/qa-retailer-six-kind-persisted-money-offer-trust-20261015.test.mjs

```

De echte zes beoordeelde lokale PLUS/Deka M1-fixtures vormen de positieve controle met 6 snapshots, 13 producten en 16 historische waarnemingen. Acht afzonderlijke mutatiecases weigeren onveilige geldbedragen, verpakkingen, datumfouten en losstaande kortingsprijzen.

Alle testmutaties gebruiken nieuwe disposable 0600 SQLite-bestanden. Bij weigering: exit 2, lege stdout en generieke stderr, zonder bron-URL, prijs of SKU. Geen live retailerrequests, geen productiepublicatie.

Deze structurele admission is geen bewijs van volledige historische byte-identiteit; daarvoor blijft `scripts/qa-retailer-reviewed-db-exact-parity.mjs` bestaan.

De werkelijke M3-gates zijn onafhankelijk: 11×11 echt veldbewijs (#78), bronrechten (#74), SHA (#205) en permanente VPS (#2833).