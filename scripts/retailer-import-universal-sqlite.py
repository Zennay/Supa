#!/usr/bin/env python3
"""Offline-only bridge: validated universal RawProductObservation -> SQLite.

Input is the in-memory JSON serialization of ingestReviewedBatch() from the
independent six-adapter engine. No HTTP, live prices, permissions or promotion.
Refuses duplicate/conflicting product identity, untrusted provenance and
non-canonical money. Creates a new private DB; never overwrites one.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import unicodedata
from urllib.parse import parse_qsl, urlsplit
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schema" / "retailer-universal-offline.v1.sql"
HOSTS = {"plus": "www.plus.nl", "dekamarkt": "www.dekamarkt.nl"}
KINDS = {"catalog", "offers", "product"}
SIX = {f"{r}:{kind}" for r in HOSTS for kind in KINDS}
UNITS = {"g", "kg", "ml", "l", "piece", "pack", "unknown"}
AVAILABILITY = {"available", "unavailable", "unknown"}
KEY = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$")
HEX_SHA = re.compile(r"^[0-9a-f]{64}$")
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$")


def check(condition, message):
    if not condition:
        raise ValueError(message)


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        check(key not in result, "JSON contains duplicate object key")
        result[key] = value
    return result


def safe_timestamp(text):
    check(isinstance(text, str) and ISO.fullmatch(text) is not None, "timestamp must be timezone qualified")
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    check(value.utcoffset() is not None and abs(value.utcoffset().total_seconds()) <= 14 * 3600,
          "impossible timezone offset")
    check(value.astimezone(timezone.utc) <= datetime.now(timezone.utc), "future source timestamp")
    return text


def utc_instant_nanoseconds(text):
    """Exact UTC ordering for ISO clocks with 1-9 fractional digits.

    datetime validates real civil dates/offsets but stores only microseconds.
    Retain all nine original fraction digits as an integer, never a float.
    """
    safe_timestamp(text)
    match = ISO.fullmatch(text)
    check(match is not None, "invalid timestamp")
    fraction = re.search(r"\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$", text)
    frac_ns = int(fraction.group(1).ljust(9, "0")) if fraction else 0
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    whole = parsed.replace(microsecond=0).astimezone(timezone.utc)
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta = whole - epoch
    return (delta.days * 86400 + delta.seconds) * 1_000_000_000 + frac_ns


def safe_local_path(value):
    """Refuse symbolic links in ANY lexical ancestor, not just the file.

    This is a static preflight before reading/creating a local file; it does
    not assert race-free defense against concurrent hostile directory swaps.
    """
    check(isinstance(value, str) and 0 < len(value) <= 4096 and
          not any(ord(char) < 32 or ord(char) == 127 for char in value),
          "unsafe private filesystem path")
    path = Path(value).absolute()
    check(".." not in path.parts, "ambiguous private filesystem path")
    for component in (path, *path.parents):
        try:
            info = component.lstat()
        except FileNotFoundError:
            continue
        check(not stat.S_ISLNK(info.st_mode), "symlinked private path refused")
    return path


def safe_string(value, label):
    check(isinstance(value, str) and bool(value.strip()) and len(value) <= 1024,
          f"{label} must be bounded visible text")
    return value.strip()


def cents(value, label):
    check(value is None or (type(value) is int and 0 <= value <= 9_007_199_254_740_991),
          f"{label} must be null or safe integer cents")
    return value


def amount(value):
    check(value is None or
          (type(value) in (int, float) and 0 < value < 1e12 and value == value),
          "pack amount invalid")
    return value


def normalized_name(name):
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


def prepare(batch):
    check(isinstance(batch, dict), "batch must be an object")
    summary = batch.get("summary")
    results = batch.get("results")
    check(isinstance(summary, dict) and isinstance(results, list), "expected reviewed engine batch")
    check(summary.get("mode") == "reviewed-offline-only" and
          summary.get("productionEnabled") is False and
          summary.get("permissionVerified") is False and
          summary.get("publicSavingsClaimEligible") is False, "batch cannot assert source rights")
    check(len(results) == 6 and summary.get("sources") == 6, "exact six reviewed pilot source kinds required")
    check(summary.get("acceptedSources") == 6 and summary.get("rejectedSources") == 0,
          "rejected source cannot silently produce a complete dataset")
    seen_sources = set()
    records = []
    for entry in results:
        check(isinstance(entry, dict) and entry.get("accepted") is True, "unaccepted source entry")
        key = entry.get("key")
        check(key in SIX and key not in seen_sources, "unknown or duplicate retailer-source kind")
        seen_sources.add(key)
        observed = entry.get("observations")
        check(isinstance(observed, list) and 0 < len(observed) <= 256, "empty or unbounded source")
        retailer, kind = key.split(":")
        seen_products = set()
        for observation in observed:
            check(isinstance(observation, dict), "invalid observation")
            check(observation.get("supermarket") == retailer and observation.get("currency") == "EUR",
                  "retailer/currency mismatch")
            product_id = observation.get("sourceProductId")
            check(isinstance(product_id, str) and KEY.fullmatch(product_id) and
                  product_id not in seen_products, "product identity missing/duplicated")
            seen_products.add(product_id)
            name = safe_string(observation.get("name"), "product name")
            price = cents(observation.get("currentPriceCents"), "current price")
            pack = observation.get("pack")
            check(isinstance(pack, dict) and pack.get("unit") in UNITS, "pack unit invalid")
            raw_pack = pack.get("rawText")
            check(raw_pack is None or isinstance(raw_pack, str) and len(raw_pack) <= 256,
                  "unsafe pack source text")
            pack_amount = amount(pack.get("amount"))
            availability = observation.get("availability")
            check(availability in AVAILABILITY, "availability status invalid")
            source = observation.get("provenance")
            check(isinstance(source, dict) and source.get("supermarket") == retailer and
                  source.get("kind") == kind, "mismatched source provenance")
            url = source.get("url")
            check(isinstance(url, str), "missing source URL")
            parsed = urlsplit(url)
            check(parsed.scheme == "https" and parsed.hostname == HOSTS[retailer] and
                  parsed.port is None and parsed.username is None and parsed.password is None and
                  not parsed.fragment, "source host or credentials invalid")
            # The direct Python CLI is independently callable: it must enforce
            # the same source-query trust boundary as the guarded JS catalog.
            # parse_qsl decodes percent escapes; casefold also rejects mixed case.
            credential_names = {"access_token", "refresh_token", "id_token",
                                "api_key", "apikey", "client_secret", "password",
                                "authorization", "token", "session"}
            check(not any(key.casefold() in credential_names or "%" in key
                          for key, _ in parse_qsl(parsed.query, keep_blank_values=True)),
                  "credential-bearing source URL query refused")
            captured = safe_timestamp(source.get("capturedAt"))
            digest = source.get("sha256")
            check(isinstance(digest, str) and HEX_SHA.fullmatch(digest),
                  "missing verified source SHA-256")
            offer = observation.get("offer")
            check(offer is None or isinstance(offer, dict), "offer shape invalid")
            if offer is not None:
                offer_label = safe_string(offer.get("label"), "offer label")
                offer_cents = cents(offer.get("offerPriceCents"), "offer price")
                original_cents = cents(offer.get("originalPriceCents"), "original offer price")
                start = offer.get("validFrom")
                end = offer.get("validTo")
                if start is not None: safe_timestamp(start)
                if end is not None: safe_timestamp(end)
                if start is not None and end is not None:
                    check(utc_instant_nanoseconds(start) <= utc_instant_nanoseconds(end),
                          "offer window reversed")
            else:
                offer_label = offer_cents = original_cents = start = end = None
            records.append((
                retailer, kind, url, captured, digest, product_id,
                name, normalized_name(name), price, raw_pack, pack_amount,
                pack["unit"], availability, offer_label, offer_cents,
                original_cents, start, end,
            ))
    check(seen_sources == SIX and len(records) == summary.get("observations"),
          "reviewed batch counts or source set mismatch")
    return records


def import_batch(batch, destination):
    rows = prepare(batch)  # Validate fully BEFORE touching the destination.
    dest = safe_local_path(destination)
    check(dest.parent.is_dir(), "destination parent directory must exist")
    check(not dest.is_symlink(), "destination symlink refused")
    fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    connection = None
    try:
        connection = sqlite3.connect(dest)
        connection.executescript(SCHEMA.read_text(encoding="utf-8"))
        connection.execute("BEGIN")
        for row in rows:
            retailer, kind, url, captured, digest, product_id, name, search_name, price, pack_text, pack_amount, unit, stock, label, offer_price, original_price, valid_from, valid_to = row
            existing = connection.execute(
                "SELECT display_name FROM products WHERE retailer_id = ? AND source_product_id = ?",
                (retailer, product_id),
            ).fetchone()
            check(existing is None or existing[0] == name, "conflicting name for source product identity")
            connection.execute(
                "INSERT OR IGNORE INTO products(retailer_id, source_product_id, display_name, search_name) VALUES (?,?,?,?)",
                (retailer, product_id, name, search_name),
            )
            connection.execute(
                "INSERT OR IGNORE INTO source_snapshots(retailer_id,kind,source_url,captured_at,content_sha256) VALUES (?,?,?,?,?)",
                (retailer, kind, url, captured, digest),
            )
            snap_id = connection.execute(
                "SELECT id FROM source_snapshots WHERE retailer_id=? AND kind=? AND source_url=? AND captured_at=? AND content_sha256=?",
                (retailer, kind, url, captured, digest),
            ).fetchone()[0]
            connection.execute(
                """INSERT INTO price_observations(
                   snapshot_id, retailer_id, source_product_id, price_cents,
                   currency, pack_text, pack_amount, pack_unit, availability,
                   offer_label, offer_price_cents, original_price_cents, offer_valid_from, offer_valid_to
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (snap_id, retailer, product_id, price, "EUR", pack_text, pack_amount, unit, stock,
                 label, offer_price, original_price, valid_from, valid_to),
            )
        connection.commit()
        result = dict(connection.execute(
            "SELECT 'products' AS name, COUNT(*) FROM products UNION ALL "
            "SELECT 'snapshots', COUNT(*) FROM source_snapshots UNION ALL "
            "SELECT 'observations', COUNT(*) FROM price_observations"
        ).fetchall())
        result.update({"created": True, "productionEnabled": False, "publicSavingsClaimEligible": False})
        return result
    except Exception:
        if connection is not None:
            connection.rollback()
            connection.close()
            connection = None
        dest.unlink(missing_ok=True)
        raise
    finally:
        if connection is not None:
            connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    source = safe_local_path(args.input)
    check(source.is_file() and not source.is_symlink() and source.stat().st_size <= 8 * 1024 * 1024,
          "offline JSON input must be a small regular file")
    batch = json.loads(source.read_text(encoding="utf-8"), object_pairs_hook=no_duplicates)
    result = import_batch(batch, args.out)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, json.JSONDecodeError):
        print("Universal offline retailer database import refused; nothing published", file=sys.stderr)
        sys.exit(1)
