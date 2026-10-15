#!/usr/bin/env python3
"""Private, offline retailer snapshot-age and field-completeness QA report.

First delegates full pilot admission to the independent six-kind gate.
No live fetch, seller license, price value or user-level output is produced.
"""
import importlib.util
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

GATE = Path(__file__).with_name("qa-retailer-sqlite-six-kind-preflight.py")
spec = importlib.util.spec_from_file_location("supa_six_kind_gate", GATE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

ISO_UTC = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$")
STORE_IDS = ("dekamarkt", "plus")


def refuse():
    raise ValueError("Offline retailer quality review refused")


def read_as_of(value):
    if not isinstance(value, str) or ISO_UTC.fullmatch(value) is None:
        refuse()
    as_of = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if as_of > datetime.now(timezone.utc):
        refuse()
    return as_of


def report(database, as_of):
    # No identity, incomplete kind set, malformed snapshot, wrong rights or
    # insecure local file may reach a successful health report.
    valid = gate.audit(database)
    target = gate.private_path(database)
    uri = "file:" + quote(target) + "?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True, timeout=2) as conn:
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA trusted_schema = OFF")
        captures = list(conn.execute(
            "SELECT retailer_id,kind,captured_at FROM source_snapshots"
        ))
        observed = list(conn.execute(
            "SELECT s.retailer_id, o.price_cents, o.pack_amount, "
            "o.pack_unit, o.availability, o.offer_price_cents "
            "FROM price_observations o JOIN source_snapshots s ON s.id=o.snapshot_id"
        ))
    per_store = {r: {
        "captureKinds": 3, "snapshots": 0, "staleSnapshots": 0,
        "futureRelativeToAssessment": 0, "observations": 0,
        "unknownPrices": 0, "unknownAvailability": 0,
        "uncertainPackages": 0, "pricedOffersPresent": 0,
    } for r in STORE_IDS}
    for retailer, kind, timestamp in captures:
        if retailer not in per_store or kind not in gate.KINDS:
            refuse()
        source = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        item = per_store[retailer]
        item["snapshots"] += 1
        if source > as_of:
            item["futureRelativeToAssessment"] += 1
        elif (as_of - source).total_seconds() > 24 * 3600:
            item["staleSnapshots"] += 1
    for retailer, cents, amount, unit, availability, offer_cents in observed:
        if retailer not in per_store:
            refuse()
        row = per_store[retailer]
        row["observations"] += 1
        row["unknownPrices"] += int(cents is None)
        row["unknownAvailability"] += int(availability == "unknown")
        row["uncertainPackages"] += int(amount is None or unit in ("pack", "unknown"))
        row["pricedOffersPresent"] += int(offer_cents is not None)
    if (sum(v["snapshots"] for v in per_store.values()) != valid["snapshots"] or
        sum(v["observations"] for v in per_store.values()) != valid["observations"]):
        refuse()
    return {
        "mode": "six-source-historical-retailer-qa-health-only",
        "assessmentClock": as_of.isoformat().replace("+00:00", "Z"),
        "maxCaptureAgeHours": 24,
        "sourceKinds": valid["sourceKinds"],
        "snapshots": valid["snapshots"],
        "products": valid["products"],
        "observations": valid["observations"],
        "stores": per_store,
        "historicalOnly": True,
        "productionEnabled": False,
        "publicSavingsClaimEligible": False,
        "trustedCurrentPrices": False,
    }


def main():
    if len(sys.argv) != 5 or sys.argv[1] != "--database" or sys.argv[3] != "--as-of":
        refuse()
    stamp = read_as_of(sys.argv[4])
    result = report(sys.argv[2], stamp)
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, TypeError, OverflowError):
        print("Historical retailer QA health report refused", file=sys.stderr)
        sys.exit(2)
