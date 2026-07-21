#!/usr/bin/env python3
"""
Export last-quarter Bistro sales from Supabase for Airtable margin / product-matrix work.

Airtable already holds Reeco invoice COGS. This script pulls the latest complete
calendar quarter of POS lines (or a named quarter) into CSV sheets you can import
into Airtable and join on Menu Item Number.

Usage
-----
  python scripts/export_quarter_for_airtable.py
  python scripts/export_quarter_for_airtable.py --quarter 2026-Q2
  python scripts/export_quarter_for_airtable.py --out exports/airtable_q2
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd

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


def quarter_months(label: str):
    # 2026-Q2 → ['2026-04','2026-05','2026-06']
    year, q = label.split("-Q")
    year = int(year)
    q = int(q)
    start = (q - 1) * 3 + 1
    return [f"{year}-{m:02d}" for m in range(start, start + 3)]


def latest_complete_quarter(period_names):
    # period_names like 2026-04
    months = sorted(period_names)
    if not months:
        return None
    # Find newest quarter where all 3 months exist
    years = sorted({int(m[:4]) for m in months})
    for year in reversed(years):
        for q in (4, 3, 2, 1):
            label = f"{year}-Q{q}"
            need = set(quarter_months(label))
            if need.issubset(set(months)):
                return label
    # Fallback: newest month's quarter even if incomplete
    y, m = months[-1].split("-")
    q = (int(m) - 1) // 3 + 1
    return f"{y}-Q{q}"


def main():
    load_env_local()
    ap = argparse.ArgumentParser()
    ap.add_argument("--venue", default="courtyard-bozeman")
    ap.add_argument("--quarter", help="e.g. 2026-Q2 (default: latest complete quarter in DB)")
    ap.add_argument("--out", default=str(ROOT / "exports" / "airtable_quarter"))
    ap.add_argument("--url", default=os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL"))
    ap.add_argument(
        "--key",
        default=os.environ.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY"),
    )
    args = ap.parse_args()
    if not args.url or not args.key:
        sys.exit("Missing Supabase URL/key")

    sb = create_client(args.url, args.key)
    venue = sb.table("tdim_venues").select("id,name").eq("slug", args.venue).maybe_single().execute()
    if not venue.data:
        sys.exit("Venue not found")
    venue_id = venue.data["id"]

    periods = (
        sb.table("tdim_periods")
        .select("id,name,row_count")
        .eq("venue_id", venue_id)
        .order("name")
        .execute()
        .data
        or []
    )
    names = [p["name"] for p in periods]
    quarter = args.quarter or latest_complete_quarter(names)
    if not quarter:
        sys.exit("No periods in Supabase. Run scripts/load_tdim_to_supabase.py first.")

    months = quarter_months(quarter)
    selected = [p for p in periods if p["name"] in months]
    if not selected:
        sys.exit("No periods for %s. Have: %s" % (quarter, names))

    print("Exporting", quarter, "months", [p["name"] for p in selected])

    all_lines = []
    for p in selected:
        start = 0
        page = 1000
        while True:
            chunk = (
                sb.table("tdim_txn_lines")
                .select(
                    "txn_at,check_number,item_name,item_number,line_total,ref_info,daypart,major_group,family_group,period_id"
                )
                .eq("period_id", p["id"])
                .range(start, start + page - 1)
                .execute()
                .data
                or []
            )
            for row in chunk:
                row["period"] = p["name"]
                row["quarter"] = quarter
            all_lines.extend(chunk)
            if len(chunk) < page:
                break
            start += page

    if not all_lines:
        sys.exit("No txn lines for selected periods")

    df = pd.DataFrame(all_lines)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Line-level for Airtable (join to Reeco on item_number)
    lines_path = out_dir / f"{quarter}_sales_lines.csv"
    df.to_csv(lines_path, index=False)

    # Item rollup ready for product matrix once COGS unit cost is attached in Airtable
    item = (
        df.groupby(["item_number", "item_name", "major_group", "family_group"], dropna=False)
        .agg(sales=("line_total", "sum"), lines=("line_total", "count"), checks=("check_number", "nunique"))
        .reset_index()
        .sort_values("sales", ascending=False)
    )
    item["unit_cost"] = ""  # fill from Reeco / recipe in Airtable
    item["contribution"] = ""  # sales - unit_cost * qty (qty≈lines until true qty exists)
    item["matrix_bucket"] = ""  # Stars / Workhorses / Hidden gems / Fix or cut
    items_path = out_dir / f"{quarter}_item_matrix_shell.csv"
    item.to_csv(items_path, index=False)

    daypart = (
        df.groupby(["daypart"], dropna=False)
        .agg(sales=("line_total", "sum"), lines=("line_total", "count"))
        .reset_index()
        .sort_values("sales", ascending=False)
    )
    daypart_path = out_dir / f"{quarter}_daypart.csv"
    daypart.to_csv(daypart_path, index=False)

    print("Wrote", lines_path)
    print("Wrote", items_path)
    print("Wrote", daypart_path)
    print("Airtable tips:")
    print("  1) Import item matrix shell as a new table")
    print("  2) Link/join Reeco costs on item_number (not name)")
    print("  3) Fill unit_cost → contribution → matrix_bucket")
    print("  4) Keep Supabase as system of record for all months")


if __name__ == "__main__":
    main()
