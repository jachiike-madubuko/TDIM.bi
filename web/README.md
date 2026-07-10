# F&B Transaction Explorer

Vite + React port of the POS BI surface. See `../HANDOFF.md` for architecture.

## Run

```bash
cd web
npm install
npm run dev
```

## Data cleaning (Python)

From the repo root:

```bash
pip install pandas openpyxl
python clean_tdim.py TDIM_26Q2.xlsx
```

Writes `TDIM_26Q2_clean.xlsx` and `TDIM_26Q2_flagged.csv`.

The same IPA 1 / TYPE IN transform also runs client-side on upload via `cleanTransactions`.

## What's expanded in v2

- Modular `src/lib` (schema, clean, query, chat) + UI components
- Beer mix starter view after IPA 1 resolution
- Family-group filters and dashboard chart
- Sales-by-day trend
- Check count + avg $/check KPIs
- Schema inspector in the left rail
- Item leaderboard search
- Export cleaned CSV
- Period filter fix for multi-file loads
- Graceful fallback when quantity column is absent (TDIM uses Check Line Total only)
