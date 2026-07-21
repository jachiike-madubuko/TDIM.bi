# Airtable Reeco → Supabase → Margins / Product Matrix

## Operating model (two lanes)

1. **All months → Supabase** for Bistro storytelling (YoY, MoM, mix movers).
   ```bash
   python scripts/load_tdim_to_supabase.py path/to/TDIM_*.xlsx
   ```
2. **Last quarter → Airtable** as the margin workspace next to Reeco invoice COGS.
   ```bash
   python scripts/export_quarter_for_airtable.py          # latest complete quarter
   python scripts/export_quarter_for_airtable.py --quarter 2026-Q2
   ```
   Imports land in `exports/airtable_quarter/`.

Supabase stays the system of record for sales history. Airtable is the analyst sandbox
for sales × COGS on one quarter, not the long-term warehouse.

## Why POS alone is not enough

Symphony TDIM `Cost of Goods Sold Amount` is zero in practice. Margin needs:

1. **Sales** from TDIM (`tdim_txn_lines`) keyed by `item_number` (Menu Item Number)
2. **Unit costs** from Reeco invoices in Airtable → join in Airtable first, later sync to `tdim_ingredient_costs`
3. **Recipe cards** (item → ingredient qty) → `tdim_recipe_cards`
4. **Rolled unit cost** per menu item → `tdim_item_cost_snapshots`

Contribution per line ≈ `line_total - (unit_cost_snapshot * quantity)`.
Until quantity exists in TDIM, treat each sold line as qty 1 or derive from price.

## Join contract (do not invent names later)

| Domain | Key | Table |
|--------|-----|-------|
| POS sales | `item_number` | `tdim_txn_lines.item_number` |
| Recipe | `item_number` | `tdim_recipe_cards.item_number` |
| Invoice SKU | `sku` | `tdim_ingredient_costs.sku` |
| Recipe component | `components[].sku` | JSON on recipe card |

Airtable record ids are stored as `airtable_record_id` for idempotent sync.

## Product matrix (ownership view)

2×2 on the latest comparable period:

- **Stars**: high sales, high margin
- **Workhorses**: high sales, low margin
- **Hidden gems**: low sales, high margin
- **Fix or cut**: low sales, low margin

YoY story then becomes: “Are we growing Stars, or just Workhorses?”

## Challenge

Do not join on item **name**. Names truncate and collide (`IPA 1`, type-ins). Number is the only stable key. If Airtable recipes use names only, fix that upstream before trusting margins.

Do not move *all* history into Airtable. Quarters are fine; multi-year sales belong in Supabase.
