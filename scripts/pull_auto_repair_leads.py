#!/usr/bin/env python3
"""
Pull US auto-repair / mechanic shop leads via the official Google Places API (New).

No scraping, Selenium, Playwright, proxies, or HTML parsing — only HTTPS calls
to Google's documented Places endpoints using the `requests` library.

Prerequisites
-------------
1. Enable "Places API (New)" on a Google Cloud project with billing.
2. Create an API key restricted to Places API (New).
3. Set the key in your environment (never commit it):

     # Windows PowerShell
     $env:GOOGLE_PLACES_API_KEY = "your-key-here"

     # macOS / Linux
     export GOOGLE_PLACES_API_KEY="your-key-here"

4. Install dependency:

     pip install requests

5. Put one search query per line in queries.txt (same folder as this script,
   or pass --queries PATH).

Billing notes (field-driven SKUs — check current Google Maps Platform pricing)
-----------------------------------------------------------------------------
- Text Search (New): POST .../v1/places:searchText
  This script only requests Essentials IDs + nextPageToken on search, so search
  calls stay on the cheaper Text Search Essentials SKU when possible.
- Place Details (New): GET .../v1/places/{placeId}
  Phone + website typically bill under Place Details Enterprise / Contact fields;
  rating / review count / businessStatus bill under Pro / Atmosphere-style fields.
  Always confirm against: https://developers.google.com/maps/billing-and-pricing/pricing

Usage
-----
  python pull_auto_repair_leads.py
  python pull_auto_repair_leads.py --queries my_cities.txt --out leads.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Endpoints (Places API New)
# ---------------------------------------------------------------------------
TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
# Place Details: GET https://places.googleapis.com/v1/places/{place_id}
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"

# Text Search field mask — IDs + pagination only (keeps search SKU lean).
# SKU: Text Search Essentials (places.id / nextPageToken).
TEXT_SEARCH_FIELD_MASK = "places.id,nextPageToken"

# Place Details field mask — contact + status + ratings.
# SKU: Place Details Essentials (id, displayName, formattedAddress, businessStatus)
#      + Pro / Atmosphere (rating, userRatingCount)
#      + Enterprise / Contact (nationalPhoneNumber, internationalPhoneNumber, websiteUri)
DETAILS_FIELD_MASK = ",".join(
    [
        "id",
        "displayName",
        "formattedAddress",
        "nationalPhoneNumber",
        "internationalPhoneNumber",
        "websiteUri",
        "rating",
        "userRatingCount",
        "businessStatus",
    ]
)

CSV_COLUMNS = [
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

DEFAULT_DELAY_SEC = 0.35
MAX_PAGES_PER_QUERY = 3  # ~20 results/page → up to ~60 places per query
MAX_RETRIES = 5


class Counters:
    def __init__(self) -> None:
        self.text_search = 0
        self.place_details = 0
        self.written = 0
        self.duplicates = 0
        self.skipped_no_phone = 0
        self.skipped_not_operational = 0
        self.failures = 0


def load_api_key() -> str:
    key = (os.environ.get("GOOGLE_PLACES_API_KEY") or "").strip()
    if not key:
        sys.exit(
            "Missing GOOGLE_PLACES_API_KEY. Set it in the environment and retry.\n"
            "Example (PowerShell): $env:GOOGLE_PLACES_API_KEY = 'YOUR_KEY'"
        )
    return key


def read_queries(path: Path) -> list[str]:
    if not path.is_file():
        sys.exit(f"queries file not found: {path}")
    queries: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        q = line.strip()
        if not q or q.startswith("#"):
            continue
        queries.append(q)
    if not queries:
        sys.exit(f"No queries found in {path}")
    return queries


def load_existing_place_ids(csv_path: Path) -> set[str]:
    """Deduplicate across re-runs by reading place_id from an existing CSV."""
    seen: set[str] = set()
    if not csv_path.is_file():
        return seen
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            pid = (row.get("place_id") or "").strip()
            if pid:
                seen.add(pid)
    return seen


def ensure_csv_header(path: Path, columns: list[str]) -> None:
    if path.is_file() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        csv.DictWriter(fh, fieldnames=columns).writeheader()


def request_with_backoff(
    session: requests.Session,
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    json_body: dict[str, Any] | None = None,
    delay_sec: float,
) -> dict[str, Any]:
    """
    Perform an HTTP call with a polite delay and exponential backoff on HTTP 429.
    Raises requests.HTTPError for non-retryable failures after retries.
    """
    attempt = 0
    while True:
        time.sleep(delay_sec)
        response = session.request(method, url, headers=headers, json=json_body, timeout=60)
        if response.status_code == 429 and attempt < MAX_RETRIES:
            # Exponential backoff: 1s, 2s, 4s, 8s, 16s
            wait = 2**attempt
            print(f"  HTTP 429 — backing off {wait}s (attempt {attempt + 1}/{MAX_RETRIES})")
            time.sleep(wait)
            attempt += 1
            continue
        if response.status_code >= 500 and attempt < MAX_RETRIES:
            wait = 2**attempt
            print(f"  HTTP {response.status_code} — retrying in {wait}s")
            time.sleep(wait)
            attempt += 1
            continue
        response.raise_for_status()
        return response.json() if response.content else {}


def text_search_page(
    session: requests.Session,
    api_key: str,
    query: str,
    page_token: str | None,
    counters: Counters,
    delay_sec: float,
) -> dict[str, Any]:
    """
    Step: Text Search (New) — POST /v1/places:searchText
    Billing: Text Search Essentials when field mask is ID-only (+ nextPageToken).
    """
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK,
    }
    body: dict[str, Any] = {
        "textQuery": query,
        "pageSize": 20,
        "regionCode": "US",
        "languageCode": "en",
        # Prefer true car_repair places (cuts dealerships / parts retailers).
        "includedType": "car_repair",
        "strictTypeFiltering": False,
    }
    if page_token:
        body["pageToken"] = page_token

    counters.text_search += 1
    print(f"  [Text Search #{counters.text_search}] query={query!r} page_token={'yes' if page_token else 'no'}")
    return request_with_backoff(
        session,
        "POST",
        TEXT_SEARCH_URL,
        headers=headers,
        json_body=body,
        delay_sec=delay_sec,
    )


def place_details(
    session: requests.Session,
    api_key: str,
    place_id: str,
    counters: Counters,
    delay_sec: float,
) -> dict[str, Any]:
    """
    Step: Place Details (New) — GET /v1/places/{placeId}
    Billing: Essentials + Pro/Atmosphere + Enterprise/Contact depending on fields.
    """
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    }
    url = PLACE_DETAILS_URL.format(place_id=place_id)
    counters.place_details += 1
    print(f"  [Place Details #{counters.place_details}] place_id={place_id}")
    return request_with_backoff(
        session,
        "GET",
        url,
        headers=headers,
        delay_sec=delay_sec,
    )


def extract_place_id(place: dict[str, Any]) -> str:
    # New API returns both "id" (ChIJ...) and "name" ("places/ChIJ...").
    pid = (place.get("id") or "").strip()
    if pid:
        return pid
    name = (place.get("name") or "").strip()
    if name.startswith("places/"):
        return name.split("/", 1)[1]
    return name


def normalize_phone(details: dict[str, Any]) -> str:
    intl = (details.get("internationalPhoneNumber") or "").strip()
    national = (details.get("nationalPhoneNumber") or "").strip()
    return intl or national


def append_lead(csv_path: Path, row: dict[str, Any]) -> None:
    with csv_path.open("a", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writerow({col: row.get(col, "") for col in CSV_COLUMNS})


def append_failure(fail_path: Path, place_id: str, reason: str, query: str) -> None:
    ensure_csv_header(fail_path, ["place_id", "query_source", "error_reason", "date_pulled"])
    with fail_path.open("a", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["place_id", "query_source", "error_reason", "date_pulled"]
        )
        writer.writerow(
            {
                "place_id": place_id,
                "query_source": query,
                "error_reason": reason,
                "date_pulled": datetime.now(timezone.utc).date().isoformat(),
            }
        )


def process_query(
    session: requests.Session,
    api_key: str,
    query: str,
    *,
    out_csv: Path,
    fail_csv: Path,
    seen_ids: set[str],
    counters: Counters,
    delay_sec: float,
) -> None:
    print(f"\n=== Query: {query} ===")
    page_token: str | None = None

    for page_index in range(MAX_PAGES_PER_QUERY):
        try:
            # New API page tokens can need a brief pause before becoming valid.
            if page_token:
                time.sleep(1.5)
            payload = text_search_page(session, api_key, query, page_token, counters, delay_sec)
        except requests.HTTPError as exc:
            counters.failures += 1
            append_failure(fail_csv, "", f"Text Search failed: {exc}", query)
            print(f"  Text Search failed: {exc}")
            return

        places = payload.get("places") or []
        if not places:
            print("  No places returned.")
            break

        for place in places:
            place_id = extract_place_id(place)
            if not place_id:
                continue

            # Deduplicate by place_id (safe re-runs).
            if place_id in seen_ids:
                counters.duplicates += 1
                continue

            try:
                details = place_details(session, api_key, place_id, counters, delay_sec)
            except requests.HTTPError as exc:
                counters.failures += 1
                append_failure(fail_csv, place_id, f"Place Details failed: {exc}", query)
                continue

            status = (details.get("businessStatus") or "").strip().upper()
            # Skip non-operational businesses.
            if status and status != "OPERATIONAL":
                counters.skipped_not_operational += 1
                continue

            phone = normalize_phone(details)
            if not phone:
                counters.skipped_no_phone += 1
                continue

            display = details.get("displayName") or {}
            name = (display.get("text") if isinstance(display, dict) else None) or ""

            row = {
                "business_name": name,
                "phone": phone,
                "address": details.get("formattedAddress") or "",
                "website": details.get("websiteUri") or "",
                "rating": details.get("rating") if details.get("rating") is not None else "",
                "review_count": details.get("userRatingCount")
                if details.get("userRatingCount") is not None
                else "",
                "place_id": place_id,
                "query_source": query,
                "date_pulled": datetime.now(timezone.utc).date().isoformat(),
            }
            append_lead(out_csv, row)
            seen_ids.add(place_id)
            counters.written += 1
            print(f"    + {name} | {phone}")

        page_token = (payload.get("nextPageToken") or "").strip() or None
        if not page_token:
            break
        print(f"  → next page ({page_index + 2}/{MAX_PAGES_PER_QUERY})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull auto-repair leads via Google Places API (New).")
    parser.add_argument(
        "--queries",
        type=Path,
        default=Path(__file__).with_name("queries.txt"),
        help="Path to queries.txt (one query per line)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).with_name("auto_repair_leads.csv"),
        help="Output CSV path",
    )
    parser.add_argument(
        "--failed",
        type=Path,
        default=Path(__file__).with_name("failed_lookups.csv"),
        help="Failed lookups CSV path",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_SEC,
        help="Base delay (seconds) between API calls",
    )
    args = parser.parse_args()

    api_key = load_api_key()
    queries = read_queries(args.queries)
    counters = Counters()

    ensure_csv_header(args.out, CSV_COLUMNS)
    seen_ids = load_existing_place_ids(args.out)
    if seen_ids:
        print(f"Loaded {len(seen_ids)} existing place_id(s) from {args.out} (will skip duplicates).")

    session = requests.Session()
    for query in queries:
        process_query(
            session,
            api_key,
            query,
            out_csv=args.out,
            fail_csv=args.failed,
            seen_ids=seen_ids,
            counters=counters,
            delay_sec=args.delay,
        )

    print("\n========== SUMMARY ==========")
    print(f"Text Search calls:     {counters.text_search}")
    print(f"Place Details calls:   {counters.place_details}")
    print(f"Leads written:         {counters.written}")
    print(f"Duplicates skipped:    {counters.duplicates}")
    print(f"No phone skipped:      {counters.skipped_no_phone}")
    print(f"Not operational:       {counters.skipped_not_operational}")
    print(f"Failures logged:       {counters.failures}")
    print(f"Output CSV:            {args.out.resolve()}")
    if counters.failures:
        print(f"Failed lookups CSV:    {args.failed.resolve()}")
    print("=============================")


if __name__ == "__main__":
    main()
