# TDIM.bi — F&B Transaction Explorer

POS transaction BI for Oracle Symphony / TDIM exports.

## App

```bash
cd web
npm install
npm run dev
```

Production: Vite app in `web/`, deployed on Vercel.

- GitHub: https://github.com/jachiike-madubuko/TDIM.bi
- Live: https://tdimbi.vercel.app (also https://tdim-bi.vercel.app)
- Project name on Vercel: `tdim.bi` (root directory: `web/`)

Note: `tdim.bi.vercel.app` is not available. Vercel reserves `*.bi.vercel.app` for another account.

## Load all months → Supabase

```bash
pip install pandas openpyxl supabase
# Full TD corpus (Aug 2024–Jun 2026) for the Aug 2025 index story:
python scripts/load_tdim_to_supabase.py TD/*.xlsx
# Or individual / quarterly files:
python scripts/load_tdim_to_supabase.py path/to/TDIM_Q1.xlsx path/to/TDIM_Q2.xlsx
```

Story Constructor (default home) indexes net sales to **2025-08 = 100** and builds Setup / Conflict / Resolution.

### Split index pipeline (anti-bias)

Bistro and catering are owned by **different agents**. Combine only after both manifests validate.

```bash
# 1) Bistro outlet index (this repo)
python scripts/export_bistro_index.py --td-dir TD
# → exports/index_pipeline/bistro_index.csv
# → exports/index_pipeline/bistro_index_manifest.json
```

2) Catering F&B index: run a **separate** Pacemaker agent with  
[`prompts/CATERING_FB_INDEX_AGENT.md`](./prompts/CATERING_FB_INDEX_AGENT.md)  
(Food + Beverage only; no rental/AV/labor/other.)

3) Combiner agent: [`prompts/COMBINER_BISTRO_CATERING_AGENT.md`](./prompts/COMBINER_BISTRO_CATERING_AGENT.md)

See [`exports/index_pipeline/README.md`](./exports/index_pipeline/README.md).

## Last quarter → Airtable (margin / product matrix)

```bash
python scripts/export_quarter_for_airtable.py
# writes exports/airtable_quarter/2026-Q2_*.csv
```

Import the item matrix shell into Airtable and join Reeco on `item_number`.
See [COGS_AIRTABLE.md](./COGS_AIRTABLE.md).


## Docs

See [HANDOFF.md](./HANDOFF.md) for architecture and expansion seams.
