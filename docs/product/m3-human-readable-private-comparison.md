# SUPA — private leesbare offline boodschappenvergelijking

Deze operatorweergave toont hetzelfde product- en mandresultaat als de bestaande M3 JSON-CLI, maar begrijpelijker: fysieke pakken, prijs per pak, subtotaal, onbekende voorraad en gedeelde producten.

```bash
node --experimental-strip-types scripts/retailer-show-private-comparison.mjs manifest.json
```

Uitsluitend lokale HTML-snapshots, **geen** nieuwe retailer HTTP. Een volledig offline verschil is geen bewijs van werkelijke besparing. Aankoopprijzen blijven onbekend bij ontbrekende producten of voorraad, en een gedeeld pak wordt niet als gratis aangemerkt. Source URLs, HTML-bestandsnamen en private paden worden niet geprint.

De M3 vrijgave blijft afhankelijk van daadwerkelijke menselijke PLUS11 + Deka11 identieke mand [#78](https://github.com/Zennay/Supa/issues/78), schriftelijke bronrechten en eigenaar-/zCloud-/permanente VPS-controles. Dit script mag niet worden gebruikt als openbaar live prijsadvies.
