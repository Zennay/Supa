#!/usr/bin/env python3
"""Read-only, bounded, internal handoff: private SUPA research SQLite -> review catalog.

Used by the product-core CLI on a NEW throwaway offline SQLite database created
from six reviewed historical fixtures. Does not publish prices or authorize a
retailer dataset. stdout is private process IPC, never CLI user output.
"""
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

HOSTS = {"plus": "www.plus.nl", "dekamarkt": "www.dekamarkt.nl"}
UNITS = {"g", "kg", "ml", "l", "piece", "pack", "unknown"}
STATES = {"available", "unavailable", "unknown"}
KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$")
SHA = re.compile(r"^[a-f0-9]{64}$")


def refuse():
    raise ValueError("Private reviewed catalog source refused")


def checked_database(path):
    if not isinstance(path, str) or not path or path.startswith("-"):
        refuse()
    target = os.path.abspath(path)
    current = target
    while True:
        try:
            mode = os.lstat(current).st_mode
        except OSError:
            refuse()
        if stat.S_ISLNK(mode):
            refuse()
        if current == target and (not stat.S_ISREG(mode) or (mode & 0o077)):
            refuse()
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    if os.stat(target).st_size > 16 * 1024 * 1024:
        refuse()
    return target


def read_reviewed_catalog(path):
    target = checked_database(path)
    uri = "file:" + quote(target) + "?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True, timeout=2) as con:
        con.execute("PRAGMA query_only = ON")
        con.execute("PRAGMA trusted_schema = OFF")
        try:
            meta = dict(con.execute("SELECT key,value FROM metadata"))
            sources = list(con.execute(
                "SELECT retailer_id,canonical_host,permission_status,production_enabled FROM retailer_sources"))
            product_count = con.execute("SELECT count(*) FROM products").fetchone()[0]
            snapshot_count = con.execute("SELECT count(*) FROM source_snapshots").fetchone()[0]
            observation_count = con.execute("SELECT count(*) FROM price_observations").fetchone()[0]
        except sqlite3.Error:
            refuse()
        if (meta.get("schema_version") != "1" or
                meta.get("origin") != "offline-reviewed-snapshots-only" or
                meta.get("production_enabled") != "false" or
                meta.get("public_savings_claim_eligible") != "false" or
                meta.get("requires_explicit_retailer_license") != "true" or
                len(sources) != 2 or product_count < 1 or product_count > 5000 or
                snapshot_count < 1 or snapshot_count > 32 or
                observation_count < product_count or observation_count > 25000):
            refuse()
        for retailer, host, permission, enabled in sources:
            if (HOSTS.get(retailer) != host or
                    permission not in ("permission_required", "unresolved") or enabled != 0):
                refuse()
        if {row[0] for row in sources} != set(HOSTS):
            refuse()
        sql = """
            SELECT p.retailer_id,p.source_product_id,p.display_name,
                   s.kind,s.source_url,s.captured_at,s.content_sha256,
                   o.currency,o.availability,o.pack_text,o.pack_amount,o.pack_unit,
                   o.price_cents,o.offer_label,o.offer_price_cents,o.original_price_cents
              FROM products p JOIN price_observations o
                ON p.retailer_id=o.retailer_id
               AND p.source_product_id=o.source_product_id
              JOIN source_snapshots s ON s.id=o.snapshot_id
             ORDER BY p.retailer_id,p.source_product_id,s.captured_at,s.id
        """
        try:
            rows = list(con.execute(sql))
        except sqlite3.Error:
            refuse()
        if len(rows) != observation_count:
            refuse()
        result = {}
        facts = {}
        for (retailer, product_id, name, kind, source_url, captured, digest,
             currency, availability, pack_text, amount, unit, price, offer_label,
             offer_price, original_price) in rows:
            if (retailer not in HOSTS or not isinstance(product_id, str) or
                not KEY.fullmatch(product_id) or not isinstance(name, str) or
                not name.strip() or len(name) > 1024 or kind not in ("product","catalog","offers") or
                currency != "EUR" or availability not in STATES or unit not in UNITS or
                not isinstance(digest, str) or not SHA.fullmatch(digest) or
                (amount is not None and (not isinstance(amount,(int,float)) or
                 not 0 < amount < 1e12)) or
                (pack_text is not None and (not isinstance(pack_text,str) or len(pack_text) > 256))):
                refuse()
            parsed = urlsplit(source_url)
            if (parsed.scheme != "https" or parsed.hostname != HOSTS[retailer] or
                    parsed.username or parsed.password or parsed.port or parsed.fragment):
                refuse()
            try:
                observed = datetime.fromisoformat(captured.replace("Z","+00:00"))
                if observed.tzinfo is None or observed.astimezone(timezone.utc) > datetime.now(timezone.utc):
                    refuse()
            except (ValueError, AttributeError):
                refuse()
            key = retailer + ":" + product_id
            if key not in result:
                result[key] = {
                    "canonicalKey": key, "retailerId": retailer,
                    "retailerProductId": product_id, "captures": [],
                    "consistency": "consistent", "currentTrustedPriceCents": None,
                    "selectedSnapshotSha256": None,
                    "sourceRightsVerified": False, "publishable": False,
                }
                facts[key] = set()
            # Sensitive money only compares historical consistency IN MEMORY;
            # never forwarded to JS, stdout, the UI or a public API.
            facts[key].add(json.dumps(
                [name, currency, availability, pack_text, amount, unit, price,
                 offer_label, offer_price, original_price], ensure_ascii=False))
            result[key]["captures"].append({
                "name": name, "currency": currency, "capturedAt": captured,
                "snapshotSha256": digest, "availability": availability,
                "pack": {"rawText": pack_text, "amount": amount, "unit": unit},
            })
        if len(result) != product_count:
            refuse()
        products = []
        for key in sorted(result):
            entry = result[key]
            if len(entry["captures"]) > 32:
                refuse()
            entry["consistency"] = ("consistent" if len(facts[key]) == 1 else "review-required")
            products.append(entry)
        return {
            "schemaVersion": 1, "model": "universal-retailer-product-captures",
            "status": "private-review-only",
            "productCount": len(products), "products": products,
            "productionEnabled": False,
            "publicSavingsClaimEligible": False,
        }


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3 or sys.argv[1] != "--database":
            refuse()
        result = read_reviewed_catalog(sys.argv[2])
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    except (ValueError, OSError, sqlite3.Error, TypeError):
        print("Private reviewed SQLite planner reader refused", file=sys.stderr)
        sys.exit(2)
