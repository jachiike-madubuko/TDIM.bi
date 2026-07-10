# TDIM.bi — F&B Transaction Explorer

POS transaction BI for Oracle Symphony / TDIM exports.

## App

```bash
cd web
npm install
npm run dev
```

Production: Vite app in `web/`, deployed on Vercel.

## Data cleaning

```bash
pip install pandas openpyxl
python clean_tdim.py TDIM_26Q2.xlsx
```

## Docs

See [HANDOFF.md](./HANDOFF.md) for architecture and expansion seams.
