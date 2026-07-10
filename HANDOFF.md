# F&B Transaction Explorer — Cursor Handoff

This is a working v1 BI surface for POS transaction data, built as a single-file React
component (`FB_Transaction_Explorer.jsx`). It runs today as an artifact. This doc is the
map for expanding it in Cursor and deploying to Vercel.

## What it does now

- Ingests xlsx/csv client-side (SheetJS + PapaParse). Load one file or several quarters.
- Auto-detects column types and maps them to F&B roles (date, daypart, menu group, item
  name/number, quantity, net sales, cost). Mapping is editable in the left rail.
- KPI cards, a filter bar (daypart, menu group, period), three starter views (Daypart,
  Menu-group, Item leaderboard), and a free-form pivot explorer.
- Saved views (in-memory) with JSON export/import.
- A deterministic chat assistant that parses a question into a query, runs it, renders a
  chart plus table, and refuses with guidance when the data can't answer.

To try it before wiring your file: click **Load sample data** (synthetic Q2 2026 that
mirrors the TDIM shape, including a zeroed COGS column).

## Architecture (one file, four layers)

1. **Ingestion + schema** — `parseFile` path in `handleFiles`, `buildSchema`, `inferType`,
   `matchRole`, `ROLE_MATCHERS`. Excel serial dates handled in `excelSerialToDate` / `toDate`.
2. **Query core** — `executeSpec(spec, rows, mapping, globalFilters)` is the one resolver.
   A `QuerySpec` is the contract (see below). The pivot builder, starter views, and chat all
   emit a QuerySpec and call `executeSpec`. Keep this stable.
3. **Chat brain** — `interpretQuery(text, ctx)` is a deterministic parser: synonym maps
   (`MEASURE_SYNONYMS`, `DIM_SYNONYMS`) plus domain refusals. It builds a QuerySpec and calls
   `executeSpec`. This is the function you swap for a real model.
4. **UI** — `FBTransactionExplorer` (default export) plus `Chart`, `ResultTable`, `StarterView`,
   `KpiCard`, `Panel`, `LabeledSelect`, `ChatBubble`.

## The three seams to expand

### Seam 1 — Real LLM assistant
Replace `interpretQuery` with a call to your backend. The contract stays the same:

```
async function interpretQuery(text, ctx) {
  // POST text + a compact schema summary (columns, roles, sample values) to /api/ask
  // The model returns a QuerySpec JSON. Validate it, then:
  const result = executeSpec(spec, ctx.rows, ctx.mapping, ctx.globalFilters);
  return { type: "answer", text: modelNarration, spec, result };
}
```

Keep the deterministic parser as the offline fallback and as a cheap fast-path for common
queries. Have the model return a QuerySpec, not prose math. The client still computes the
numbers with `executeSpec`, so answers stay correct and auditable. The refusal cases
(margin, labor, inventory, forecasting) should move into the system prompt so the model
inherits the same honesty.

### Seam 2 — Persistence
`savedViews`, `mappingOverride`, and loaded datasets are React state. Move them to your DB
(Supabase/Postgres). A `saved_views` table keyed by user + venue, storing the QuerySpec JSON,
is enough. Swap `exportViews`/`importViews` for API calls. localStorage was avoided on purpose
so this port is clean.

### Seam 3 — Server-side data
Client-side xlsx parsing is fine for one venue's quarter. For the ERP, push ingestion to a
job that lands rows in Postgres (or DuckDB), and have `executeSpec` run as SQL. The QuerySpec
maps directly to `SELECT agg(measure) ... GROUP BY dim ... WHERE filters`. That's your path
to multi-venue and multi-year without loading everything into the browser.

## QuerySpec contract

```
{
  measureField, measureRole, measureLabel,
  agg: 'sum' | 'avg' | 'count' | 'distinct',
  groupField, groupRole, groupLabel,
  groupMode: 'value' | 'day' | 'week' | 'month' | 'period',
  filters: [{ field, values }],
  topN, order: 'desc' | 'asc',
  viz: 'bar' | 'line' | 'pie' | 'kpi'
}
```

## Data assumptions (TDIM / Oracle Symphony)

- Join key for items is the item **Number**, not the name (names truncate). The item
  leaderboard groups on name for readability but you should switch to Number once joins matter.
- **COGS is zero** in the POS export. Margin, food cost, and contribution cannot be computed
  here. They require Reeco invoice unit costs joined to Recipe Cards on item Number. The
  assistant already refuses margin questions with this exact guidance.
- Datetimes may be Excel serials. `toDate` converts serials in the 20000–80000 range.
- Dayparts and menu groups are the primary dimensions.

## Data cleaning: IPA 1 type-in resolution

The app auto-cleans on ingest via `cleanTransactions`. A generic beer button
(`IPA 1`) followed by a `TYPE IN` line whose `Reference Information Line 1` holds
the real beer gets resolved: the reference text is moved into `Menu Item Name` on
the `IPA 1` line, and the `TYPE IN` row is deleted. Scope is name-targeted
(default `["IPA 1"]`), so nothing else is renamed. Resolutions whose text matches a
food item name or a kitchen-note pattern are flagged in the cleaning report, not
trusted silently. `clean_tdim.py` runs the identical transform for the pipeline and
emits a cleaned file plus a flagged CSV.

When you move to a backend, run this transform server-side before load, and widen
`targetNames` if other generic buttons (IPA 2, DRAFT 1) show the same pattern. The
better long-term fix is a POS config change so the beer rings on its own PLU, which
kills the need for this step.

## Known limits / untested paths

This v1 was written without a browser to run it in, so treat the first load as a smoke test:
- Verify xlsx headers map correctly, then correct any role in the left-rail mapping editor.
- Blob downloads (CSV, views JSON) rely on the iframe allowing downloads; they work in a real
  browser tab on Vercel.
- The parser is keyword-based. It handles the common F&B question shapes; unusual phrasings
  fall through to a clear "couldn't parse" with the available fields listed.

## Suggested Cursor build order

1. Drop the component into a Vite or Next.js app. Confirm it renders with sample data.
2. Load a real TDIM file, fix mapping, sanity-check KPIs against a known number.
3. Add the `/api/ask` route and swap Seam 1.
4. Add Supabase and swap Seam 2.
5. When multi-venue, swap Seam 3 to SQL.
