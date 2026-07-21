#!/usr/bin/env python3
"""
Bulk-load Symphony TDIM exports into Supabase (tdim_periods + tdim_txn_lines).

Splits each file into calendar months so Story / YoY can stack periods.
Uses the same IPA 1 cleaning + header detection as clean_tdim.py.

Usage
-----
  export SUPABASE_URL=https://....supabase.co
  export SUPABASE_ANON_KEY=eyJ...
  # or: source from web/.env.local

  python scripts/load_tdim_to_supabase.py TDIM_26Q2.xlsx
  python scripts/load_tdim_to_supabase.py path/to/TDIM.xlsx --venue courtyard-bozeman
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd

from clean_tdim import clean, load_tdim

try:
    from supabase import create_client
except ImportError:
    sys.exit("Install supabase: pip install supabase")


def load_env_local():
    env_path = ROOT / "web" / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def s(v):
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    return str(v)


def serialize_cell(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if hasattr(v, "isoformat"):
        try:
            return {"__tdimDate": v.isoformat()}
        except Exception:
            return str(v)
    # pandas Timestamp
    if type(v).__name__ in ("Timestamp", "NaTType"):
        if pd.isna(v):
            return None
        return {"__tdimDate": pd.Timestamp(v).isoformat()}
    return v


def row_to_json(row: dict) -> dict:
    return {k: serialize_cell(v) for k, v in row.items()}


def row_to_line(venue_id: str, period_id: str, row: dict) -> dict:
    def num(x):
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return None
        try:
            return float(x)
        except Exception:
            return None

    txn = row.get("Transaction Date and Time")
    txn_at = None
    if txn is not None and not (isinstance(txn, float) and math.isnan(txn)):
        try:
            txn_at = pd.Timestamp(txn).isoformat()
        except Exception:
            txn_at = None

    return {
        "venue_id": venue_id,
        "period_id": period_id,
        "txn_at": txn_at,
        "check_number": s(row.get("Check Number")) or None,
        "item_name": s(row.get("Menu Item Name")) or None,
        "item_number": s(row.get("Menu Item Number")) or None,
        "line_total": num(row.get("Check Line Total")),
        "ref_info": s(row.get("Reference Information Line 1")) or None,
        "cogs_amount": num(row.get("Cost of Goods Sold Amount")),
        "daypart": s(row.get("Day Part Name")) or None,
        "quarter_hour": s(row.get("Quarter Hour")) or None,
        "major_group": s(row.get("Major Group Name")) or None,
        "family_group": s(row.get("Family Group Name")) or None,
        "raw": row_to_json(row),
    }


def chunked(seq, n=400):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def upsert_month(sb, venue_id: str, period_name: str, df: pd.DataFrame, summary: dict, source: str):
    records = df.to_dict("records")
    rows_json = [row_to_json(r) for r in records]
    payload = {
        "venue_id": venue_id,
        "name": period_name,
        "source_filename": source,
        "row_count": len(records),
        "cleaning_summary": summary,
        "import_meta": {"period": period_name, "sourceFilename": source, "backend": "bulk_loader"},
        "rows_json": rows_json,
        "updated_at": pd.Timestamp.utcnow().isoformat(),
    }
    res = (
        sb.table("tdim_periods")
        .upsert(payload, on_conflict="venue_id,name")
        .execute()
    )
    period_id = res.data[0]["id"]

    sb.table("tdim_txn_lines").delete().eq("period_id", period_id).execute()
    lines = [row_to_line(venue_id, period_id, r) for r in records]
    for batch in chunked(lines, 400):
        sb.table("tdim_txn_lines").insert(batch).execute()

    return period_id, len(records)


def main():
    load_env_local()
    ap = argparse.ArgumentParser(description="Load TDIM xlsx into Supabase by month")
    ap.add_argument("inputs", nargs="+", help="TDIM xlsx/csv path(s)")
    ap.add_argument("--venue", default="courtyard-bozeman")
    ap.add_argument("--url", default=os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL"))
    ap.add_argument(
        "--key",
        default=os.environ.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY"),
    )
    args = ap.parse_args()

    if not args.url or not args.key:
        sys.exit("Missing SUPABASE URL/key. Set web/.env.local or pass --url/--key.")

    sb = create_client(args.url, args.key)
    venue = sb.table("tdim_venues").select("id").eq("slug", args.venue).maybe_single().execute()
    if not venue.data:
        sys.exit("Venue not found: %s" % args.venue)
    venue_id = venue.data["id"]

    for path in args.inputs:
        print("Loading", path)
        df, header_row = load_tdim(path)
        print("  header Excel row", header_row, "raw rows", len(df))
        cleaned, summary = clean(df)
        print(
            "  cleaned rows",
            summary["output_rows"],
            "IPA resolved",
            summary["resolved"],
            "flagged",
            len(summary["flagged"]),
        )

        date_col = next(c for c in cleaned.columns if "date" in c.lower())
        cleaned = cleaned.copy()
        cleaned["__month"] = pd.to_datetime(cleaned[date_col], errors="coerce").dt.strftime("%Y-%m")
        months = [m for m in sorted(cleaned["__month"].dropna().unique()) if m and m != "NaT"]
        print("  months", months)

        for month in months:
            part = cleaned[cleaned["__month"] == month].drop(columns=["__month"])
            # Flagged list is not JSON-serializable if empty issues — ensure plain dicts
            summary_json = {
                "input_rows": int(summary["input_rows"]),
                "ipa_lines": int(summary["ipa_lines"]),
                "resolved": int(summary["resolved"]),
                "deleted": int(summary["deleted"]),
                "unpaired": int(summary["unpaired"]),
                "output_rows": int(len(part)),
                "flagged": summary["flagged"],
            }
            pid, n = upsert_month(sb, venue_id, month, part, summary_json, os.path.basename(path))
            print("  upserted", month, "→", n, "lines", "period", pid)

    print("Done.")


if __name__ == "__main__":
    main()
