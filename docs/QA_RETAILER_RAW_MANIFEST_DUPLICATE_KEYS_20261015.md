# Onafhankelijke QA — dubbele ruwe JSON-sleutels in privé retailer-manifesten

**Onderzoek, niet mergen vóór een eigenaar-reparatie.** De SHA-gebonden offline manifest-replay leest een echt 0600 `manifest.json` en zes beoordeelde PLUS/Deka-evidencerecords. Zijn huidige bytecontrole beschermt tegen onbedoelde inhoudswijzigingen, maar een bestands-SHA garandeert **niet** dat de JSON-structuur eenduidig is.

JSON met twee keer dezelfde sleutel kan door een standaardparser stilzwijgend worden geïnterpreteerd als de **laatste** waarde. Daardoor lijken tegenstrijdige rechten, bronsets, digests, adapterversies, retailervermelding of acquisition-safety-verificaties achteraf geldig. Voor een veiligheids-/toestemmingscontract moet dit **fail closed** zijn en niet stilzwijgend worden samengevouwen.

## Reproduceerbare offline checks

```sh
node --experimental-strip-types --test tests/qa-retailer-manifest-raw-duplicate-key-20261015.test.mjs
```

De QA-test kopieert uitsluitend de zes oorspronkelijke lokale bronnen naar een volledig wegwerpbare privémap (0600), creëert een geldig SHA-manifest en verandert vervolgens **één** ambiguïteit: een dubbele `permissionVerified`, dubbele `sources`, dubbel `sha256`, dubbele `version`, dubbele `source.supermarket` of dubbele `browserEvidence.safety.antiBotBypass`. Als ruwe capturebytes wijzigen, past de test alleen de **lokale manifest-SHA** mee aan om de JSON-ambiguïteit los van byte-integriteit te kunnen testen.

**Verwachte acceptatie:** oorspronkelijke zes-fixture replay blijft groen; elk van de zes dubbelzinnige JSON-documenten wordt geweigerd zonder enige stdout-uitvoer, prijs, SKU of privélocatie in fouten. Niet pas achteraf de waarde valideren; al tijdens JSON-decoding dubbele sleutels detecteren, inclusief geneste objecten. Houd de huidige 1 MiB/64 KiB-grenzen, 0600/no-symlink/no-hardlinkregels, adaptervormvalidatie en SHA-bindings intact. Zorg voor exact-herhaalde regressie op de reparatie-SHA.

Deze QA-only PR wijzigt **geen** product-engine, manifest-tool, live retailerdata, scraper, CI-workflow of actieve peer-branche. Geen toestemming voor retailerdata wordt verleend. M3 #74/#78/#205/#2833 blijven afzonderlijk open.