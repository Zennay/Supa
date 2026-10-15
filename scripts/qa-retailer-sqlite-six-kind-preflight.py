#!/usr/bin/env python3
"""Independent read-only QA gate for Supa's six-source historical retailer pilot.

This is NOT a permission grant, live-data admission, or production reader.
Use on a newly built PRIVATE 0600 SQLite export. Print only bounded counts.
"""
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
from datetime import datetime, timezone
from urllib.parse import parse_qsl, quote, urlsplit

HOSTS = {"plus": "www.plus.nl", "dekamarkt": "www.dekamarkt.nl"}
RIGHTS = {"plus": "permission_required", "dekamarkt": "unresolved"}
KINDS = {"product", "catalog", "offers"}
EXPECTED = {(retailer, kind) for retailer in HOSTS for kind in KINDS}
SHA = re.compile(r"^[a-f0-9]{64}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$")


def check(ok):
    if not ok:
        raise ValueError("private pilot rejected")


def private_path(value):
    check(isinstance(value, str) and bool(value) and not value.startswith("-"))
    path = os.path.abspath(value)
    current = path
    while True:
        mode = os.lstat(current).st_mode
        check(not stat.S_ISLNK(mode))
        if current == path:
            check(stat.S_ISREG(mode) and mode & 0o077 == 0)
        parent = os.path.dirname(current)
        if current == parent:
            break
        current = parent
    check(os.stat(path).st_size <= 16 * 1024 * 1024)
    return path


def source_ok(retailer, kind, url, captured, digest):
    check(retailer in HOSTS and kind in KINDS)
    check(isinstance(digest, str) and SHA.fullmatch(digest) is not None)
    check(isinstance(url, str) and len(url) <= 2048)
    parsed = urlsplit(url)
    check(parsed.scheme == "https" and parsed.hostname == HOSTS[retailer]
          and parsed.username is None and parsed.password is None
          and parsed.port is None and not parsed.fragment)
    # Refuse URL query bearer/API credentials even if HTTPS hostname is trusted.
    sensitive = {"access_token", "token", "api_key", "apikey", "auth",
                 "authorization", "session", "secret", "password", "signature"}
    check(not any(key.casefold().replace("-", "_") in sensitive
                  for key, _ in parse_qsl(parsed.query, keep_blank_values=True)))
    check(isinstance(captured, str) and DATE.fullmatch(captured) is not None)
    instant = datetime.fromisoformat(captured.replace("Z", "+00:00"))
    check(instant.utcoffset() is not None and
          abs(instant.utcoffset().total_seconds()) <= 14 * 3600)
    check(instant.astimezone(timezone.utc) <= datetime.now(timezone.utc))


def audit(path):
    target = private_path(path)
    uri = "file:" + quote(target) + "?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True, timeout=2) as conn:
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA trusted_schema = OFF")
        meta_rows = list(conn.execute("SELECT key,value FROM metadata"))
        check(len(meta_rows) == 5 and
              {key for key, _ in meta_rows} == {
                  "schema_version", "origin", "production_enabled",
                  "public_savings_claim_eligible", "requires_explicit_retailer_license",
              })
        meta = dict(meta_rows)
        check(meta.get("schema_version") == "1" and
              meta.get("origin") == "offline-reviewed-snapshots-only" and
              meta.get("production_enabled") == "false" and
              meta.get("public_savings_claim_eligible") == "false" and
              meta.get("requires_explicit_retailer_license") == "true")
        sources = list(conn.execute(
            "SELECT retailer_id,canonical_host,permission_status,production_enabled FROM retailer_sources"))
        check(len(sources) == 2 and {item[0] for item in sources} == set(HOSTS))
        for retailer, host, permission, enabled in sources:
            check(host == HOSTS[retailer] and permission == RIGHTS[retailer] and enabled == 0)

        snaps = list(conn.execute(
            "SELECT id,retailer_id,kind,source_url,captured_at,content_sha256 FROM source_snapshots"))
        check(6 <= len(snaps) <= 64)
        observed_kinds = set()
        ids = set()
        for sid, retailer, kind, url, captured, digest in snaps:
            check(isinstance(sid, int) and sid not in ids)
            ids.add(sid)
            source_ok(retailer, kind, url, captured, digest)
            observed_kinds.add((retailer, kind))
        check(observed_kinds == EXPECTED)
        products = list(conn.execute(
            "SELECT retailer_id, count(*) FROM products GROUP BY retailer_id"))
        product_counts = dict(products)
        check(set(product_counts) == set(HOSTS) and
              all(0 < count <= 5000 for count in product_counts.values()))
        # A plausible count is not proof every product has source evidence.
        # Keep this structural check distinct from exact 16-row fixture parity.
        product_keys = set(conn.execute(
            "SELECT retailer_id,source_product_id FROM products"))
        check(len(product_keys) == sum(product_counts.values()))
        observations = list(conn.execute(
            "SELECT o.snapshot_id,o.retailer_id,o.source_product_id,s.retailer_id,s.kind "
            "FROM price_observations o LEFT JOIN source_snapshots s ON s.id=o.snapshot_id"))
        check(len(observations) >= len(snaps) and len(observations) <= 25000)
        evidence_count = {item: 0 for item in EXPECTED}
        observed_snapshot_ids = set()
        observed_product_keys = set()
        for sid, retailer, product, snapshot_retailer, kind in observations:
            check(sid in ids and snapshot_retailer == retailer and
                  (retailer, kind) in EXPECTED)
            evidence_count[(retailer, kind)] += 1
            observed_snapshot_ids.add(sid)
            observed_product_keys.add((retailer, product))
            check(conn.execute(
                "SELECT 1 FROM products WHERE retailer_id=? AND source_product_id=?",
                (retailer, product)).fetchone() is not None)
        check(all(n > 0 for n in evidence_count.values()))
        check(observed_snapshot_ids == ids and observed_product_keys == product_keys)
        return {
            "mode": "offline-retailer-six-kind-qa-only",
            "accepted": True,
            "sourceKinds": len(observed_kinds),
            "snapshots": len(snaps),
            "products": sum(product_counts.values()),
            "observations": len(observations),
            "retailerKinds": {r: sum(1 for k in KINDS if evidence_count[(r, k)] > 0) for r in sorted(HOSTS)},
            "productionEnabled": False,
            "publicSavingsClaimEligible": False,
        }


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "--database":
        raise ValueError("expected private offline database")
    print(json.dumps(audit(sys.argv[2]), sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, TypeError, OverflowError):
        print("Private retailer six-kind QA preflight refused", file=sys.stderr)
        sys.exit(2)
