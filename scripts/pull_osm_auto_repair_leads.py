#!/usr/bin/env python3
"""
Pull US auto-repair / garage / workshop leads from OpenStreetMap via Overpass API.

Legitimate public data — no Google Maps scraping, no HTML scraping.
Phones exist only when mappers tagged `phone` / `contact:phone` (often sparse).

Usage:
  python scripts/pull_osm_auto_repair_leads.py
  python scripts/pull_osm_auto_repair_leads.py --metros "Houston,Dallas,Austin" --out scripts/osm_leads.csv

Then import CSV on /leads/import (or scripts/import_leads.py).
"""

from __future__ import annotations

import argparse
import csv
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    import requests
except ImportError:
    raise SystemExit("Install requests: pip install requests")

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

# Approximate metro bounding boxes (south,west,north,east) — continental US focus.
METROS: dict[str, tuple[float, float, float, float]] = {
    "Houston": (29.4, -95.9, 30.2, -94.9),
    "Dallas": (32.5, -97.5, 33.2, -96.4),
    "Austin": (30.0, -98.1, 30.6, -97.4),
    "Phoenix": (33.2, -112.4, 33.8, -111.7),
    "Chicago": (41.6, -88.0, 42.1, -87.4),
    "Atlanta": (33.5, -84.7, 34.0, -84.1),
    "Denver": (39.5, -105.2, 40.0, -104.7),
    "Seattle": (47.4, -122.5, 47.8, -122.1),
    "Detroit": (42.2, -83.4, 42.5, -82.9),
    "Charlotte": (35.0, -81.1, 35.4, -80.6),
    "Columbus": (39.8, -83.2, 40.2, -82.8),
    "Nashville": (35.9, -87.0, 36.3, -86.5),
    "Portland": (45.4, -122.9, 45.7, -122.4),
    "Las Vegas": (35.9, -115.4, 36.3, -114.9),
    "Miami": (25.6, -80.5, 26.0, -80.0),
}

CSV_FIELDS = [
    "business_name",
    "phone",
    "address",
    "website",
    "rating",
    "review_count",
    "place_id",
    "query_source",
    "date_pulled",
]


def digits_phone(raw: str) -> str:
    d = re.sub(r"\D", "", raw or "")
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if len(d) == 10:
        return f"({d[0:3]}) {d[3:6]}-{d[6:10]}"
    return (raw or "").strip()


def build_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    # car repair / garage / vehicle workshop tags commonly used on OSM
    return f"""
    [out:json][timeout:90];
    (
      node["amenity"="car_repair"]({s},{w},{n},{e});
      way["amenity"="car_repair"]({s},{w},{n},{e});
      node["shop"="car_repair"]({s},{w},{n},{e});
      way["shop"="car_repair"]({s},{w},{n},{e});
      node["shop"="tyres"]({s},{w},{n},{e});
      way["shop"="tyres"]({s},{w},{n},{e});
      node["craft"="car_repair"]({s},{w},{n},{e});
      way["craft"="car_repair"]({s},{w},{n},{e});
    );
    out center tags;
    """


def fetch_overpass(query: str) -> dict[str, Any]:
    last_err = ""
    for url in OVERPASS_URLS:
        for attempt in range(3):
            try:
                r = requests.post(
                    url,
                    data={"data": query},
                    timeout=180,
                    headers={"User-Agent": "AutoGaragifyLeadPuller/1.0 (B2B research; contact via app)"},
                )
                if r.status_code == 200:
                    return r.json()
                last_err = f"{url} HTTP {r.status_code}"
                # Rate limited — wait and retry this host
                if r.status_code in (429, 504, 502):
                    time.sleep(8 + attempt * 10)
                    continue
            except Exception as exc:  # noqa: BLE001
                last_err = f"{url} {exc}"
                time.sleep(3)
            break
        time.sleep(2)
    raise RuntimeError(f"Overpass failed: {last_err}")


def element_to_row(el: dict[str, Any], metro: str, pulled: str) -> dict[str, str] | None:
    tags = el.get("tags") or {}
    name = (tags.get("name") or tags.get("operator") or "").strip()
    if not name:
        return None
    phone_raw = (
        tags.get("phone")
        or tags.get("contact:phone")
        or tags.get("telephone")
        or ""
    ).strip()
    phone = digits_phone(phone_raw)
    # Prefer rows with phones for calling lists; still keep name-only if --all
    website = (tags.get("website") or tags.get("contact:website") or tags.get("url") or "").strip()
    addr_parts = [
        tags.get("addr:housenumber", ""),
        tags.get("addr:street", ""),
        tags.get("addr:city", "") or metro,
        tags.get("addr:state", ""),
        tags.get("addr:postcode", ""),
    ]
    address = " ".join(p for p in addr_parts if p).strip() or metro
    osm_type = el.get("type", "node")
    osm_id = el.get("id")
    place_id = f"osm:{osm_type}:{osm_id}"
    return {
        "business_name": name,
        "phone": phone,
        "address": address,
        "website": website,
        "rating": "",
        "review_count": "",
        "place_id": place_id,
        "query_source": f"osm overpass car_repair in {metro}",
        "date_pulled": pulled,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="OSM Overpass US auto-repair lead puller")
    parser.add_argument(
        "--metros",
        default="Houston,Dallas,Austin,Phoenix,Chicago",
        help="Comma-separated metro keys from built-in list",
    )
    parser.add_argument(
        "--out",
        default=str(Path("scripts") / "osm_auto_repair_leads.csv"),
        help="Output CSV path",
    )
    parser.add_argument(
        "--phones-only",
        action="store_true",
        default=True,
        help="Only keep rows that have a phone (default: true)",
    )
    parser.add_argument(
        "--include-no-phone",
        action="store_true",
        help="Keep shops even without phone tags",
    )
    args = parser.parse_args()
    phones_only = not args.include_no_phone

    metros = [m.strip() for m in args.metros.split(",") if m.strip()]
    unknown = [m for m in metros if m not in METROS]
    if unknown:
        print(f"Unknown metros (skipped): {unknown}")
        print(f"Known: {', '.join(sorted(METROS))}")
    metros = [m for m in metros if m in METROS]
    if not metros:
        print("No valid metros.")
        return 1

    pulled = datetime.now(timezone.utc).date().isoformat()
    seen: set[str] = set()
    rows: list[dict[str, str]] = []

    for metro in metros:
        print(f"[{metro}] querying Overpass…")
        try:
            data = fetch_overpass(build_query(METROS[metro]))
        except Exception as exc:  # noqa: BLE001
            print(f"[{metro}] ERROR: {exc}")
            continue
        elements = data.get("elements") or []
        added = 0
        with_phone = 0
        for el in elements:
            row = element_to_row(el, metro, pulled)
            if not row:
                continue
            if phones_only and not row["phone"]:
                continue
            if row["place_id"] in seen:
                continue
            seen.add(row["place_id"])
            rows.append(row)
            added += 1
            if row["phone"]:
                with_phone += 1
        print(f"[{metro}] kept {added} (phones={with_phone}) from {len(elements)} OSM objects")
        time.sleep(1.5)  # be polite to Overpass

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        w.writerows(rows)

    msg = f"Wrote {len(rows)} leads to {out}"
    print(msg.encode("ascii", "replace").decode("ascii"))
    print("Next: import on /leads/import (do NOT enable DIALER until legal review)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
