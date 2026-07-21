#!/usr/bin/env python3
"""
Bistro index export pipeline (TDIM / outlet only).

Produces a trackable package under exports/index_pipeline/:
  - bistro_index.csv          monthly series indexed to INDEX_MONTH (= 100)
  - bistro_index_manifest.json  source, method, checksums, column contract

This script does NOT touch Pacemaker / catering. A separate agent owns catering F&B.
A third agent should combine the two CSVs.

Usage
-----
  python scripts/export_bistro_index.py --td-dir TD
  python scripts/export_bistro_index.py --from-supabase
  python scripts/export_bistro_index.py --td-dir TD --index-month 2025-08
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "exports" / "index_pipeline"
DEFAULT_INDEX_MONTH = "2025-08"

COLUMNS = [
    "month",
    "label",
    "zone",
    "bistro_sales",
    "index_month",
    "index_sales",
    "index_value",
    "delta_vs_index_pts",
    "delta_vs_index_dollars",
    "deficit_dollars",
    "surplus_dollars",
    "is_deficit",
]


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


def month_label(month: str) -> str:
    y, m = month.split("-")
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{names[int(m) - 1]} {y}"


def zone_for(month: str, index_month: str) -> str:
    if month == index_month:
        return "index"
    if month < index_month:
        return "before"
    return "after"


def monthly_from_td(td_dir: Path) -> tuple[pd.DataFrame, dict]:
    sys.path.insert(0, str(ROOT))
    from clean_tdim import clean, load_tdim

    frames = []
    sources = []
    for path in sorted(td_dir.glob("*.xlsx")):
        df, header_row = load_tdim(str(path))
        cleaned, summary = clean(df)
        date_col = next(c for c in cleaned.columns if "date" in c.lower())
        sales_col = next(
            c for c in cleaned.columns if c == "Check Line Total" or "line total" in c.lower()
        )
        part = cleaned.copy()
        part["month"] = pd.to_datetime(part[date_col], errors="coerce").dt.strftime("%Y-%m")
        frames.append(
            part.groupby("month", as_index=False)[sales_col]
            .sum()
            .rename(columns={sales_col: "bistro_sales"})
        )
        sources.append(
            {
                "file": path.name,
                "header_excel_row": header_row,
                "output_rows": int(summary.get("output_rows", len(cleaned))),
                "ipa_resolved": int(summary.get("resolved", 0)),
            }
        )
    if not frames:
        sys.exit(f"No TD xlsx in {td_dir}")
    monthly = (
        pd.concat(frames, ignore_index=True)
        .groupby("month", as_index=False)["bistro_sales"]
        .sum()
        .sort_values("month")
    )
    meta = {"source": "td_folder", "td_dir": str(td_dir), "files": sources}
    return monthly, meta


def monthly_from_supabase() -> tuple[pd.DataFrame, dict]:
    load_env_local()
    try:
        from supabase import create_client
    except ImportError:
        sys.exit("Install supabase: pip install supabase")

    url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Missing Supabase URL/key in web/.env.local")

    sb = create_client(url, key)
    res = sb.table("tdim_periods").select("name, rows_json, source_filename, row_count").order("name").execute()
    periods = res.data or []
    if not periods:
        sys.exit("No tdim_periods found")

    rows = []
    period_meta = []
    for p in periods:
        month = p.get("name")
        n = 0
        for r in p.get("rows_json") or []:
            total = r.get("Check Line Total")
            if total is None:
                continue
            try:
                rows.append({"month": month, "bistro_sales": float(total)})
                n += 1
            except (TypeError, ValueError):
                continue
        period_meta.append(
            {
                "period": month,
                "source_filename": p.get("source_filename"),
                "row_count": p.get("row_count"),
                "lines_summed": n,
            }
        )
    if not rows:
        sys.exit("No Check Line Total values in tdim_periods.rows_json")
    monthly = pd.DataFrame(rows).groupby("month", as_index=False)["bistro_sales"].sum().sort_values("month")
    meta = {"source": "supabase_tdim_periods", "periods": period_meta}
    return monthly, meta


def build_index(monthly: pd.DataFrame, index_month: str) -> pd.DataFrame:
    monthly = monthly.sort_values("month").copy()
    hit = monthly.loc[monthly["month"] == index_month, "bistro_sales"]
    if hit.empty or float(hit.iloc[0]) == 0:
        have = ", ".join(monthly["month"].astype(str).tolist())
        sys.exit(f"Index month {index_month} missing or zero. Have: {have}")
    index_sales = float(hit.iloc[0])
    out = pd.DataFrame(
        {
            "month": monthly["month"],
            "label": monthly["month"].map(month_label),
            "zone": monthly["month"].map(lambda m: zone_for(m, index_month)),
            "bistro_sales": monthly["bistro_sales"].round(2),
            "index_month": index_month,
            "index_sales": round(index_sales, 2),
            "index_value": (monthly["bistro_sales"] / index_sales * 100).round(1),
            "delta_vs_index_pts": ((monthly["bistro_sales"] / index_sales * 100) - 100).round(1),
            "delta_vs_index_dollars": (monthly["bistro_sales"] - index_sales).round(2),
            "deficit_dollars": (index_sales - monthly["bistro_sales"]).clip(lower=0).round(2),
            "surplus_dollars": (monthly["bistro_sales"] - index_sales).clip(lower=0).round(2),
            "is_deficit": ((index_sales - monthly["bistro_sales"]) > 0).astype(int),
        }
    )
    return out[COLUMNS]


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description="Export Bistro index package (outlet only)")
    ap.add_argument("--td-dir", type=Path, default=ROOT / "TD")
    ap.add_argument("--from-supabase", action="store_true")
    ap.add_argument("--index-month", default=DEFAULT_INDEX_MONTH)
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    if args.from_supabase:
        monthly, source_meta = monthly_from_supabase()
    elif args.td_dir.exists():
        monthly, source_meta = monthly_from_td(args.td_dir)
    else:
        sys.exit(f"TD dir not found: {args.td_dir} (or pass --from-supabase)")

    indexed = build_index(monthly, args.index_month)
    csv_path = args.out_dir / "bistro_index.csv"
    manifest_path = args.out_dir / "bistro_index_manifest.json"
    indexed.to_csv(csv_path, index=False)

    after = indexed[indexed["zone"] == "after"]
    manifest = {
        "pipeline": "bistro_index",
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "index_month": args.index_month,
        "index_definition": f"index_value = bistro_sales / sales({args.index_month}) * 100",
        "measure": "Check Line Total (net sales lines after IPA cleaning)",
        "grain": "calendar month (YYYY-MM)",
        "join_key": "month",
        "columns": COLUMNS,
        "column_notes": {
            "index_value": "100 at index_month",
            "deficit_dollars": "max(0, index_sales - bistro_sales)",
            "surplus_dollars": "max(0, bistro_sales - index_sales)",
            "zone": "before | index | after relative to index_month",
        },
        "row_count": int(len(indexed)),
        "span": f"{indexed['month'].iloc[0]} → {indexed['month'].iloc[-1]}" if len(indexed) else None,
        "after_index": {
            "months": int(len(after)),
            "deficit_sum": float(after["deficit_dollars"].sum()) if len(after) else 0.0,
            "months_below_100": int((after["index_value"] < 100).sum()) if len(after) else 0,
        },
        "source": source_meta,
        "outputs": {
            "csv": str(csv_path.relative_to(ROOT)),
            "csv_sha256": file_sha256(csv_path),
            "manifest": str(manifest_path.relative_to(ROOT)),
        },
        "out_of_scope": [
            "Pacemaker / catering pace",
            "Rental, AV, Labor, Other",
            "Any join or narrative overlay with catering",
        ],
        "combiner_input": "Pass this CSV + catering_fb_index.csv from the catering agent. Join on month.",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    print("Wrote", csv_path)
    print("Wrote", manifest_path)
    print(
        f"Index {args.index_month} = {float(indexed.loc[indexed['zone']=='index','index_sales'].iloc[0]):,.2f} · "
        f"{len(indexed)} months · after-deficit sum {manifest['after_index']['deficit_sum']:,.2f}"
    )


if __name__ == "__main__":
    main()
