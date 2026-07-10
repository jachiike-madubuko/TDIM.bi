#!/usr/bin/env python3
"""
clean_tdim.py — POS type-in resolution for TDIM / Oracle Symphony exports.

Problem it fixes
----------------
A generic beer button ("IPA 1") is rung on a check, then the server adds a
"TYPE IN" line whose "Reference Information Line 1" holds the actual beer
(e.g. MIDAS). The TYPE IN line has 0.00 sales and sits in FOOD / MODIFIERS, so
beer sales read "IPA 1" and the real identity you need to attach cost is stranded.

What it does (scope: only rows named "IPA 1")
---------------------------------------------
For each "IPA 1" line, find the next "TYPE IN" line on the SAME check number
whose Reference Information Line 1 is non-empty. Move that text into the IPA 1
line's Menu Item Name, then delete the TYPE IN row. Nothing else is renamed.

Any resolution whose text matches a known food item name (e.g. SALMON) or looks
like a kitchen note (86, side, sub, no, extra) is written to a review file, not
silently trusted.

Usage
-----
    pip install pandas openpyxl
    python clean_tdim.py TDIM_26Q2.xlsx
    python clean_tdim.py TDIM_26Q2.xlsx --output cleaned.xlsx --target "IPA 1"

Outputs
-------
    <input>_clean.xlsx     cleaned transactions (same columns, TYPE IN rows removed)
    <input>_flagged.csv    resolutions to eyeball (check, renamed_to, reason)

NOTE: This was written in an environment without a runnable sandbox, so run it
once on a copy and compare row counts before trusting it in the pipeline.
"""

import argparse
import math
import os
import sys

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas is required. Install with: pip install pandas openpyxl")


def s(v):
    """Safe string: treat None and NaN as empty."""
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    return str(v)


def find_col(columns, exact, contains):
    """Match a column by exact name first, then by a 'contains' keyword."""
    lower = {c.lower(): c for c in columns}
    if exact.lower() in lower:
        return lower[exact.lower()]
    for c in columns:
        if contains in c.lower():
            return c
    return None


def clean(df, target_name="IPA 1", typein_name="TYPE IN"):
    columns = list(df.columns)
    name_col = find_col(columns, "Menu Item Name", "menu item name") or find_col(columns, "Menu Item Name", "item name")
    check_col = find_col(columns, "Check Number", "check number") or find_col(columns, "Check Number", "check")
    ref_col = find_col(columns, "Reference Information Line 1", "reference information") or find_col(columns, "Reference Information Line 1", "reference")
    group_col = find_col(columns, "Major Group Name", "major group") or find_col(columns, "Major Group Name", "group")

    if not name_col:
        raise ValueError("Could not find a Menu Item Name column. Columns seen: %s" % columns)

    records = df.to_dict("records")
    target = target_name.strip().upper()
    typein = typein_name.strip().upper()

    def nm(r):
        return s(r.get(name_col)).strip().upper()

    def ck(r):
        return s(r.get(check_col)) if check_col else "__ALL__"

    # Non-beverage item names, used to flag suspicious resolutions.
    food_names = set()
    bev = ["BEER", "WINE", "LIQUOR", "SPIRIT", "COCKTAIL", "NON ALC", "NON-ALC", "BEVERAGE", "BAR"]
    if group_col:
        for r in records:
            g = s(r.get(group_col)).upper()
            name = nm(r)
            if name and name != typein and not any(b in g for b in bev):
                food_names.add(name)

    import re
    kitchen_pat = re.compile(r"^(86\b|no |sub\b|sub |side |extra |add |light |hold |on side)", re.I)

    to_delete = set()
    flagged = []
    resolved = 0
    ipa_lines = 0
    unpaired = []

    n = len(records)
    for i in range(n):
        if nm(records[i]) != target:
            continue
        ipa_lines += 1
        paired = False
        for j in range(i + 1, n):
            if ck(records[j]) != ck(records[i]):
                break
            if j in to_delete:
                continue
            if nm(records[j]) == typein:
                ref = s(records[j].get(ref_col)).strip() if ref_col else ""
                if ref:
                    records[i][name_col] = ref
                    to_delete.add(j)
                    resolved += 1
                    paired = True
                    up = ref.upper()
                    if up in food_names or kitchen_pat.match(ref):
                        flagged.append({
                            "check": ck(records[i]),
                            "renamed_to": ref,
                            "reason": "matches a food item name" if up in food_names else "looks like a kitchen note",
                        })
                    break
        if not paired:
            unpaired.append(ck(records[i]))

    cleaned = [r for k, r in enumerate(records) if k not in to_delete]
    out_df = pd.DataFrame(cleaned, columns=columns)
    summary = {
        "input_rows": n,
        "ipa_lines": ipa_lines,
        "resolved": resolved,
        "deleted": len(to_delete),
        "unpaired": len(unpaired),
        "output_rows": len(cleaned),
        "flagged": flagged,
    }
    return out_df, summary


def main():
    ap = argparse.ArgumentParser(description="Resolve IPA 1 / TYPE IN beer lines in a TDIM export.")
    ap.add_argument("input", help="Path to the TDIM xlsx (or csv)")
    ap.add_argument("--output", help="Cleaned output path (default: <input>_clean.xlsx)")
    ap.add_argument("--review", help="Flagged review CSV path (default: <input>_flagged.csv)")
    ap.add_argument("--target", default="IPA 1", help='Menu Item Name to resolve (default: "IPA 1")')
    args = ap.parse_args()

    base, _ = os.path.splitext(args.input)
    out_path = args.output or (base + "_clean.xlsx")
    review_path = args.review or (base + "_flagged.csv")

    if args.input.lower().endswith(".csv"):
        df = pd.read_csv(args.input, dtype=object)
    else:
        df = pd.read_excel(args.input, dtype=object)

    out_df, summary = clean(df, target_name=args.target)

    if out_path.lower().endswith(".csv"):
        out_df.to_csv(out_path, index=False)
    else:
        out_df.to_excel(out_path, index=False)

    if summary["flagged"]:
        pd.DataFrame(summary["flagged"]).to_csv(review_path, index=False)

    print("Cleaning complete.")
    print("  input rows      :", summary["input_rows"])
    print("  IPA 1 lines     :", summary["ipa_lines"])
    print("  resolved        :", summary["resolved"])
    print("  TYPE IN removed :", summary["deleted"])
    print("  unpaired IPA 1  :", summary["unpaired"], "(kept their name)")
    print("  output rows     :", summary["output_rows"])
    print("  flagged         :", len(summary["flagged"]), "-> %s" % (review_path if summary["flagged"] else "none"))
    print("  written         :", out_path)


if __name__ == "__main__":
    main()
