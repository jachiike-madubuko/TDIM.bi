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

## Data cleaning

```bash
pip install pandas openpyxl
python clean_tdim.py TDIM_26Q2.xlsx
```

## Docs

See [HANDOFF.md](./HANDOFF.md) for architecture and expansion seams.
