#!/usr/bin/env python3
"""
Headless import of auto_repair_leads.csv into AutoGaragify.

Calls the same server import path as the UI: POST /api/leads/import

Prerequisites
-------------
1. App running (next dev or production) with DATABASE_URL configured.
2. Environment:
     LEADS_IMPORT_SECRET   — shared secret (also set on the Next.js server)
     LEADS_IMPORT_SHOP_ID  — shop id that should own the leads
     APP_URL               — e.g. http://localhost:3000 or https://autogaragify.com

Usage
-----
  python scripts/import_leads.py scripts/auto_repair_leads.csv
  python scripts/import_leads.py path/to/leads.csv --url http://localhost:3000
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Places CSV leads into AutoGaragify")
    parser.add_argument("csv", type=Path, help="Path to auto_repair_leads.csv")
    parser.add_argument(
        "--url",
        default=os.environ.get("APP_URL", "http://localhost:3000").rstrip("/"),
        help="AutoGaragify base URL",
    )
    args = parser.parse_args()

    if not args.csv.is_file():
        print(f"CSV not found: {args.csv}", file=sys.stderr)
        return 1

    secret = (os.environ.get("LEADS_IMPORT_SECRET") or "").strip()
    shop_id = (os.environ.get("LEADS_IMPORT_SHOP_ID") or "").strip()
    if not secret or not shop_id:
        print(
            "Set LEADS_IMPORT_SECRET and LEADS_IMPORT_SHOP_ID in the environment.",
            file=sys.stderr,
        )
        return 1

    csv_text = args.csv.read_text(encoding="utf-8")
    endpoint = f"{args.url}/api/leads/import"
    body = json.dumps({"csv": csv_text}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Leads-Import-Secret": secret,
            "X-Shop-Id": shop_id,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"Import failed ({exc.code}): {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Could not reach {endpoint}: {exc}", file=sys.stderr)
        return 1

    print(payload.get("message") or "Import complete")
    print(f"  imported:   {payload.get('imported', 0)}")
    print(f"  duplicates: {payload.get('duplicates', 0)}")
    print(f"  failed:     {payload.get('failed', 0)}")

    report = payload.get("errorReportCsv") or ""
    if payload.get("failed") and report:
        out = args.csv.with_name(args.csv.stem + "-import-errors.csv")
        out.write_text(report, encoding="utf-8")
        print(f"  error report: {out}")

    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
