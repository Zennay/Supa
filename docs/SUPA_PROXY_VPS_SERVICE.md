# Supa: VPS proxy-health with owned HTTPS echo

This add-only operator integration is **not a retailer scraper** and does not grant data rights. It monitors untrusted public proxy candidates *only against an explicit HTTPS echo endpoint owned by the operator*. Never use public proxies for credentials, customer data, retailer 403/429/CAPTCHA bypass or unauthorized requests.

## Prerequisite: owned HTTPS echo endpoint

Configure a real public domain and HTTPS server you control. For GET /health?supa_probe=0123456789abcdef0123456789abcdef it must return HTTP 200, an uncompressed plain-text response with Content-Length, and exact body:

    supa-proxy-ok:0123456789abcdef0123456789abcdef

The 32-character hex challenge changes for every request. No redirects, cookies, credentials or third-party test endpoints. An invalid or absent domain causes the service to fail **before any network requests**. A sample *.example host is a placeholder only and cannot perform actual checks.


## Included optional owned echo origin

This PR also includes a minimal loopback-only Node responder. It listens on 127.0.0.1:12789 and returns the strict nonce challenge in Content-Length. An operator-controlled HTTPS reverse proxy with a real domain/certificate is **still mandatory**. Example Caddy site config, on a domain you own:

    probe.your-real-owned-domain.nl {
      reverse_proxy 127.0.0.1:12789
    }

After installing the reviewed files, enable the local responder as your VPS user:

    cp deploy/systemd-user/supa-proxy-echo.service ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now supa-proxy-echo.service
    curl -fsS 'http://127.0.0.1:12789/health?supa_probe=0123456789abcdef0123456789abcdef'

The final curl must return the expected ASCII body. The local HTTP origin is **never** a substitute for publicly reachable HTTPS on your OWNED domain; public proxies cannot reach your VPS's loopback. Configure the trusted reverse proxy only under a separately reviewed TLS/DNS change.

## Deploy on VPS as ubuntu user (after reviewed PR integration)

Check that the reviewed Supa checkout is at /home/ubuntu/Supa and Node 22+ is available on the user service PATH; adapt the unit if either differs.

    cd /home/ubuntu/Supa && git pull --ff-only
    mkdir -p -m 700 ~/.config ~/.local/state/supa-proxy-health ~/.config/systemd/user
    printf '%s\n' \
      'SUPA_PROXY_OWNED_HOST=probe.your-real-owned-domain.nl' \
      'SUPA_PROXY_OWNED_ECHO_URL=https://probe.your-real-owned-domain.nl/health' \
      > ~/.config/supa-proxy-health.env
    chmod 600 ~/.config/supa-proxy-health.env
    cp deploy/systemd-user/supa-proxy-health.{service,timer} ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now supa-proxy-health.timer
    systemctl --user start supa-proxy-health.service
    systemctl --user list-timers supa-proxy-health.timer
    journalctl --user -u supa-proxy-health.service -n 30 --no-pager
    node scripts/retailer-proxy-health-service.mjs --status

**Replace the sample hostname with your own configured domain.** Ensure that the echo endpoint actually works. This user unit writes its own files, not any root-owned state or zCloud SQLite DB. For operation after logout, user lingering may need enabling by an authorized operator: sudo loginctl enable-linger ubuntu.

The user service is intentionally systemd Type=oneshot: the **timer** should remain active (waiting), while the service appears inactive (dead) between runs.

## Operation and safety invariants

- Timer checks at most every five minutes. The built-in persistent last-refresh timestamp limits the pinned proxy candidate feed refresh to once per hour.
- Provider HTTPS URL is exact and pinned with no redirect, credentials or excessive payloads; streamed feed max 512 KiB; only validated public IPv4/port candidates are accepted.
- Each cycle probes at most eight candidates, five seconds each, by HTTP CONNECT strictly to the configured owned host on port 443. A subsequent CA-verified TLS handshake and per-request nonce response are required to establish health. No healthy result is inferred from connecting alone.
- Health TTL 15 minutes; failures use exponential cooldown/quarantine. Missing data or failed source checks never authorize forwarding traffic.
- Persistent JSON state is kept under ~/.local/state/supa-proxy-health/state.json, 0700 directory and 0600 file, with atomic writes. Status and logs contain counters only; no proxy IPs, retailer product facts or personal data.
- There is **no proxy router to retailers or user-facing API** in this release; permission gate remains false. A retailer 403/429/CAPTCHA must never trigger proxy rotation.
- Disable: systemctl --user disable --now supa-proxy-health.timer
- Local offline tests: node --test tests/retailer-proxy-health-service.test.mjs
- Full product gates: npm ci; npm test; npm run m1:source-permission-gate; npm run build.

Live permission and release approvals are distinct: issues #74 (retailer rights), #78 (genuine matched field evidence) and #205 (source pin) remain separate from candidate-health readiness. Do not claim an active VPS deployment without an actual timer/log and owned-endpoint proof.
