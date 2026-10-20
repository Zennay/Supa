# Receptimport URL-voorcontrole (geen netwerkaanroep)

Onderdeel van [feature #3263](https://github.com/Zennay/Supa/issues/3263), onafhankelijk van de actieve [JSON-LD parser #3264](https://github.com/Zennay/Supa/pull/3264) en metrische [portieschaalmodule #3268](https://github.com/Zennay/Supa/pull/3268).

`assessRecipeSourceUrl(value)` in `src/domain/userRecipeSourceUrl.ts` controleert de door de gebruiker geplakte bronlink vóórdat een toekomstige server HTML ophaalt. Geeft uitsluitend een veilige **previewbeoordeling**. Zelfs wanneer `accepted:true` retourneert de functie **`fetchReady:false`**: dit is nooit toestemming om een netwerkfetch te starten.

- Alleen duidelijk geschreven HTTPS-URL's met gewone DNS-hostnaam; begrensd tot 2048 tekens.
- Blokkeert IPv4/IPv6-literals (inclusief gecodeerde getallen), localhost/interne/special-use suffixen, obfuscaties, credential-userinfo, credentialachtige querykeys en niet-standaard HTTPS-poorten.
- Verwijdert URL-fragmenten uit het genormaliseerde previewadres. Geen netwerk, IP-resolutie, HTML-interpretatie, cookies of log van het originele adres.
- Om echte import aan te zetten is een **separate serverfetcher** verplicht: geauthenticeerde gebruiker, bij ieder request en **iedere redirect** DNS en alle IP's controleren (ook DNS rebinding en het feitelijk verbonden adres), alleen publieke IP-netten, HTTPS/TLS en redirectlimiet, timeouts, HTML-MIME/byteslimiet, geen cookies of userinfo, rate limits, auditlog zonder tokens, redirect- en SSRF-regressies, en aansluiting op de preview/review in #3264. Een positieve tekst-URL-check alleen is nooit voldoende voor SSRF-bescherming.
- De code haalt geen live retailerinformatie op en verleent geen bronnenrecht. M3 blijft ACTIVE/HOLD voor #74/#78/#205, zCloud writer-lease en toepasselijke trusted VPS-tests.

**Test:** `node --experimental-strip-types --test tests/user-recipe-source-url-20261016.test.mjs`.
