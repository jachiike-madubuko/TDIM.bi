#!/usr/bin/env python3
"""
DEPRECATED for decision-making.

Prefer the split pipeline:
  1) python scripts/export_bistro_index.py --td-dir TD
  2) Separate Pacemaker agent: prompts/CATERING_FB_INDEX_AGENT.md
  3) Combiner agent: prompts/COMBINER_BISTRO_CATERING_AGENT.md

This script still exists only as a local scratch join against pace_tidy.csv.
Do not treat its catering numbers as audited.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACE = Path("/Users/jahvilla/Projects/pace maker/pace_tidy.csv")
OUT_DIR = ROOT / "exports" / "story_overlap"
INDEX_MONTH = "2025-08"


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


def bistro_from_td_folder(td_dir: Path) -> pd.DataFrame:
    """Aggregate monthly sales from local TD/*.xlsx (fast path)."""
    sys.path.insert(0, str(ROOT))
    from clean_tdim import clean, load_tdim

    frames = []
    for path in sorted(td_dir.glob("*.xlsx")):
        df, _ = load_tdim(str(path))
        cleaned, _ = clean(df)
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
    if not frames:
        sys.exit(f"No TD xlsx files in {td_dir}")
    monthly = (
        pd.concat(frames, ignore_index=True)
        .groupby("month", as_index=False)["bistro_sales"]
        .sum()
        .sort_values("month")
    )
    return index_frame(monthly)


def bistro_from_supabase() -> pd.DataFrame:
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
    # Prefer period rollups when present (name is YYYY-MM, rows_json holds lines)
    res = sb.table("tdim_periods").select("name, rows_json").order("name").execute()
    periods = res.data or []
    if not periods:
        sys.exit("No tdim_periods found")

    rows = []
    for p in periods:
        month = p.get("name")
        for r in p.get("rows_json") or []:
            total = r.get("Check Line Total")
            if total is None:
                continue
            try:
                rows.append({"month": month, "bistro_sales": float(total)})
            except (TypeError, ValueError):
                continue
    if not rows:
        sys.exit("No sales lines in tdim_periods.rows_json")
    monthly = pd.DataFrame(rows).groupby("month", as_index=False)["bistro_sales"].sum()
    return index_frame(monthly)


def bistro_from_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    # Accept UI export or minimal month/sales
    if "bistro_sales" in df.columns and "index_value" in df.columns:
        return df
    if "month" in df.columns and "sales" in df.columns:
        return index_frame(df.rename(columns={"sales": "bistro_sales"})[["month", "bistro_sales"]])
    sys.exit("Bistro CSV needs bistro_sales+index_value or month+sales columns")


def index_frame(monthly: pd.DataFrame) -> pd.DataFrame:
    monthly = monthly.sort_values("month").copy()
    idx = monthly.loc[monthly["month"] == INDEX_MONTH, "bistro_sales"]
    if idx.empty or float(idx.iloc[0]) == 0:
        sys.exit(f"Missing index month {INDEX_MONTH} in bistro series")
    index_sales = float(idx.iloc[0])
    monthly["index_month"] = INDEX_MONTH
    monthly["index_sales"] = index_sales
    monthly["index_value"] = (monthly["bistro_sales"] / index_sales * 100).round(1)
    monthly["delta_vs_index_dollars"] = (monthly["bistro_sales"] - index_sales).round(2)
    monthly["deficit_dollars"] = (index_sales - monthly["bistro_sales"]).clip(lower=0).round(2)
    monthly["surplus_dollars"] = (monthly["bistro_sales"] - index_sales).clip(lower=0).round(2)
    monthly["zone"] = monthly["month"].map(
        lambda m: "index" if m == INDEX_MONTH else ("before" if m < INDEX_MONTH else "after")
    )
    monthly["is_deficit"] = (monthly["deficit_dollars"] > 0).astype(int)
    return monthly


# Pace categories that count as outlet-comparable F&B (exclude Rental, AV, Labor, Other, Total).
CATERING_FB_CATEGORIES = ("Food", "Beverage")


def catering_from_pace(path: Path) -> pd.DataFrame:
    """Courtyard Definite Food + Beverage only (no rental / AV / labor / other)."""
    if not path.exists():
        sys.exit(f"Pace tidy CSV not found: {path}")
    df = pd.read_csv(path)
    cy = df[(df["property"] == "Courtyard Bozeman") & (df["is_total_column"] == 0)].copy()
    booked = cy[
        (cy["block"] == "booked")
        & (cy["status"] == "Definite")
        & (cy["category"].isin(CATERING_FB_CATEGORIES))
    ]
    # Sum Food + Beverage per month
    fb = (
        booked.groupby("month", as_index=False)["amount"]
        .sum()
        .rename(columns={"amount": "catering_fb"})
        .sort_values("month")
    )
    fb["catering_categories"] = "Food+Beverage"

    # Prior-year same month
    prior_map = fb.set_index("month")["catering_fb"].to_dict()
    fb["catering_prior_year"] = fb["month"].map(lambda m: prior_map.get(f"{int(m[:4]) - 1}-{m[5:]}"))
    fb["catering_yoy_delta"] = fb["catering_fb"] - fb["catering_prior_year"]
    fb["catering_yoy_surplus"] = fb["catering_yoy_delta"].clip(lower=0)
    fb["catering_yoy_deficit"] = (-fb["catering_yoy_delta"]).clip(lower=0)

    # Catering F&B index to Aug 2025 (same spine as bistro)
    aug = fb.loc[fb["month"] == INDEX_MONTH, "catering_fb"]
    if not aug.empty and float(aug.iloc[0]) > 0:
        aug_v = float(aug.iloc[0])
        fb["catering_index_month"] = INDEX_MONTH
        fb["catering_index_base"] = aug_v
        fb["catering_index_value"] = (fb["catering_fb"] / aug_v * 100).round(1)
        fb["catering_vs_aug_delta"] = (fb["catering_fb"] - aug_v).round(2)
    return fb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bistro-csv", type=Path, default=None, help="Optional UI-exported bistro index CSV")
    ap.add_argument("--td-dir", type=Path, default=ROOT / "TD", help="Local TD folder (preferred fast path)")
    ap.add_argument("--from-supabase", action="store_true", help="Build bistro series from Supabase periods")
    ap.add_argument("--pace-csv", type=Path, default=DEFAULT_PACE)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    if args.bistro_csv:
        bistro = bistro_from_csv(args.bistro_csv)
    elif args.from_supabase:
        bistro = bistro_from_supabase()
    elif args.td_dir.exists():
        bistro = bistro_from_td_folder(args.td_dir)
    else:
        bistro = bistro_from_supabase()
    catering = catering_from_pace(args.pace_csv)

    bistro_path = args.out / "bistro_index_deficits.csv"
    cater_path = args.out / "catering_definite_fb.csv"
    join_path = args.out / "bistro_x_catering_overlap.csv"

    bistro.to_csv(bistro_path, index=False)
    catering.to_csv(cater_path, index=False)

    # Overlap: focus after index (the "since last meeting" window)
    merged = bistro.merge(catering, on="month", how="outer").sort_values("month")
    merged["cover_ratio"] = merged.apply(
        lambda r: (r["catering_fb"] / r["deficit_dollars"])
        if pd.notna(r.get("deficit_dollars")) and r["deficit_dollars"] > 0 and pd.notna(r.get("catering_fb"))
        else None,
        axis=1,
    )
    merged["story_flag"] = merged.apply(
        lambda r: (
            "catering_cover"
            if pd.notna(r.get("deficit_dollars"))
            and r["deficit_dollars"] > 0
            and pd.notna(r.get("catering_yoy_delta"))
            and r["catering_yoy_delta"] > 0
            else (
                "dual_soft"
                if pd.notna(r.get("deficit_dollars"))
                and r["deficit_dollars"] > 0
                and pd.notna(r.get("catering_yoy_delta"))
                and r["catering_yoy_delta"] <= 0
                else ""
            )
        ),
        axis=1,
    )
    merged.to_csv(join_path, index=False)

    after = merged[merged["zone"] == "after"]
    cover = after[after["story_flag"] == "catering_cover"]
    print("Wrote", bistro_path)
    print("Wrote", cater_path)
    print("Wrote", join_path)
    print(
        f"After {INDEX_MONTH}: {len(after)} months · "
        f"{int(cover.shape[0])} months where bistro deficit + catering YoY surplus (catering_cover)"
    )
    if len(after):
        print(
            "Bistro deficit sum (after):",
            round(after["deficit_dollars"].fillna(0).sum(), 2),
            "| Catering YoY surplus sum (after, positives only):",
            round(after["catering_yoy_surplus"].fillna(0).sum(), 2),
        )


if __name__ == "__main__":
    main()
