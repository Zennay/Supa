#!/usr/bin/env python3
"""Read-only, aggregate-only M3 audit of a private historical retailer SQLite file.

This tool cannot approve retailer source rights, publish historic prices or
turn a reviewed offline import into verified current basket evidence.
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

REFUSAL = "Private historical retailer SQLite audit refused; no data published"
HOSTS = {
    "plus": ("www.plus.nl", "permission_required"),
    "dekamarkt": ("www.dekamarkt.nl", "unresolved"),
}
KINDS = {"product", "catalog", "offers"}
META = {
    "schema_version": "1",
    "origin": "offline-reviewed-snapshots-only",
    "production_enabled": "false",
    "public_savings_claim_eligible": "false",
    "requires_explicit_retailer_license": "true",
}
MAX_BYTES = 32 * 1024 * 1024


class AuditRefusal(Exception):
    pass


def require(condition):
    if not condition:
        raise AuditRefusal()


def approved_path(value):
    require(isinstance(value, str) and 0 < len(value) <= 4096)
    require(not any(ord(character) < 32 or ord(character) == 127 for character in value))
    require(not value.startswith("-"))
    target = Path(os.path.abspath(value))
    # No symlink ancestors: a caller cannot redirect a private file into a
    # different location while using an innocent-looking relative path.
    for item in (target, *target.parents):
        require(not stat.S_ISLNK(item.lstat().st_mode))
    mode = target.stat()
    require(stat.S_ISREG(mode.st_mode) and mode.st_nlink == 1)
    require(stat.S_IMODE(mode.st_mode) == 0o600)
    require(100 <= mode.st_size <= MAX_BYTES)
    # This audits a *finished* import, never a mutable WAL writer's view.
    # immutable=1 would otherwise ignore uncheckpointed WAL transactions.
    require(not any(os.path.lexists(str(target) + suffix)
                    for suffix in ("-wal", "-shm", "-journal")))
    with target.open("rb") as handle:
        require(handle.read(16) == b"SQLite format 3\x00")
    return target


def audit(path):
    target = approved_path(path)
    # immutable+mode=ro never create journal/WAL/sidecar files and cannot write
    # to a database. This command is only for *finished* offline imports.
    uri = "file:" + quote(str(target), safe="/") + "?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True, timeout=2) as db:
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("PRAGMA foreign_keys=ON")
        require(db.execute("PRAGMA integrity_check").fetchone() == ("ok",))
        require(db.execute("PRAGMA foreign_key_check").fetchone() is None)
        # Reject unexpected or removed tables, never evaluate stored SQL.
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        require(tables == {
            "retailer_sources", "products", "source_snapshots",
            "price_observations", "metadata",
        })
        metadata_rows = db.execute("SELECT key,value FROM metadata").fetchall()
        require(len(metadata_rows) == len(META) and dict(metadata_rows) == META)
        sources = db.execute(
            "SELECT retailer_id,canonical_host,permission_status,production_enabled "
            "FROM retailer_sources"
        ).fetchall()
        require(len(sources) == 2)
        require({retailer: (host, permission) for retailer, host, permission, active in sources}
                == HOSTS)
        require(all(active == 0 for _, _, _, active in sources))
        snapshots = db.execute(
            "SELECT retailer_id,kind FROM source_snapshots"
        ).fetchall()
        require(len(snapshots) == 6)
        require(set(snapshots) == {
            (retailer, kind) for retailer in HOSTS for kind in KINDS
        })
        # A named source shape is not evidence if it stores no observations.
        # Verify every stored origin instead of trusting a forged aggregate.
        origins = db.execute(
            "SELECT s.retailer_id, s.source_url, s.captured_at, "
            "COUNT(p.snapshot_id) FROM source_snapshots AS s "
            "LEFT JOIN price_observations AS p ON p.snapshot_id=s.id "
            "GROUP BY s.id"
        ).fetchall()
        require(len(origins) == 6)
        for retailer, url, captured_at, count in origins:
            require(count > 0 and isinstance(url, str))
            parsed = urlsplit(url)
            require(parsed.scheme == "https" and parsed.hostname == HOSTS[retailer][0])
            require(parsed.username is None and parsed.password is None and
                    parsed.port is None and not parsed.fragment)
            forbidden = {"access_token", "api_key", "apikey", "password",
                         "token", "auth", "authorization", "session"}
            require(not any(key.casefold() in forbidden
                            for key, _ in parse_qsl(parsed.query, keep_blank_values=True)))
            require(isinstance(captured_at, str) and re.fullmatch(
                r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})",
                captured_at
            ) is not None)
            parsed_time = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
            require(parsed_time <= datetime.now(timezone.utc))
        product_count = db.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        observation_count = db.execute(
            "SELECT COUNT(*) FROM price_observations"
        ).fetchone()[0]
        require(0 < product_count <= 1536 and 0 < observation_count <= 1536)
        # An observation's retailer must match the snapshot AND product; FK
        # alone allows the first relationship to drift across two valid stores.
        require(db.execute(
            "SELECT 1 FROM price_observations AS p "
            "JOIN source_snapshots AS s ON s.id=p.snapshot_id "
            "WHERE s.retailer_id <> p.retailer_id LIMIT 1"
        ).fetchone() is None)
        require(db.execute(
            "SELECT 1 FROM price_observations AS p "
            "LEFT JOIN products AS x ON x.retailer_id=p.retailer_id "
            "AND x.source_product_id=p.source_product_id "
            "WHERE x.source_product_id IS NULL LIMIT 1"
        ).fetchone() is None)
        require(db.execute(
            "SELECT 1 FROM price_observations WHERE currency <> 'EUR' "
            "OR availability NOT IN ('available','unavailable','unknown') LIMIT 1"
        ).fetchone() is None)
        require(db.execute(
            "SELECT 1 FROM source_snapshots WHERE length(content_sha256) <> 64 "
            "OR content_sha256 GLOB '*[^0-9a-f]*' LIMIT 1"
        ).fetchone() is None)
        return {
            "schemaVersion": 1,
            "mode": "historical-private-sqlite-readonly-audit",
            "retailers": 2,
            "sourceKinds": 6,
            "products": product_count,
            "historicalObservations": observation_count,
            "databaseIntegrityVerified": True,
            "sourceRightsVerified": False,
            "actualRetailerPricesVerified": False,
            "fullBasketFieldComparisonVerified": False,
            "publicSavingsClaimEligible": False,
            "productionEnabled": False,
            "releaseDecision": "hold",
        }


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    require(len(args) == 2 and args[0] == "--db")
    report = audit(args[1])
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (AuditRefusal, OSError, ValueError, TypeError, sqlite3.Error):
        print(REFUSAL, file=sys.stderr)
        sys.exit(2)
