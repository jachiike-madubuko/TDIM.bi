import React, { useState, useMemo, useRef } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import _ from "lodash";

/*
  F&B Transaction Explorer
  A Tableau-like BI surface for POS transaction data (Oracle Symphony / TDIM exports).

  Design goals (read HANDOFF.md for the full map):
  - Schema-flexible: ingests whatever columns a file has, infers types, auto-maps
    to F&B roles, and lets the user correct the mapping.
  - One deterministic query engine (executeSpec) powers the pivot builder, the
    starter views, and the chat assistant. Swap `interpretQuery` for a real LLM
    endpoint later; keep executeSpec.
  - No localStorage (artifact constraint). Saved views persist in-memory and via
    JSON export/import. Wire real persistence when this moves to a backend.
*/

/* ============================ constants ============================ */

const CHART_COLORS = [
  "#4f46e5",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#65a30d",
  "#2563eb",
  "#ea580c",
];

// Canonical F&B roles. Order matters: earlier roles win when headers overlap
// (e.g. "gross sales" must resolve to grossSales before netSales grabs "sales").
const ROLE_MATCHERS = [
  ["itemNumber", ["menu item number", "item number", "item no", "item id", "item #", "object number", "plu number", "plu", "sku"]],
  ["checkId", ["guest check", "check number", "check no", "check id", "ticket number", "receipt number", "order number"]],
  ["refInfo", ["reference information line 1", "reference information", "reference info", "ref info", "reference line 1", "reference line", "ref line", "type in text"]],
  ["checkCount", ["check count", "cover count", "guest count", "covers", "guests", "checks", "tickets"]],
  ["quantity", ["item quantity", "qty sold", "quantity sold", "units sold", "quantity", "qty", "units", "count sold", "sold count"]],
  ["grossSales", ["gross sales", "gross sale", "gross amount", "gross revenue", "gross"]],
  ["discount", ["discount amount", "discounts", "discount", "comp amount", "comps", "comp"]],
  ["cost", ["cost of goods sold", "cost of goods", "food cost", "item cost", "unit cost", "cogs", "cost"]],
  ["tax", ["tax amount", "sales tax", "tax"]],
  ["price", ["unit price", "item price", "menu price", "price"]],
  ["netSales", ["net sales", "net sale", "net amount", "net revenue", "check line total", "line total", "sales total", "total sales", "sales amount", "net", "sales", "revenue", "amount", "total"]],
  ["date", ["business date", "transaction date", "order date", "trans date", "posting date", "date"]],
  ["daypart", ["daypart", "day part", "meal period", "service period", "revenue period", "meal"]],
  ["familyGroup", ["family group name", "family group", "sub group", "subgroup", "family"]],
  ["menuGroup", ["major group", "menu group", "major category", "menu category", "product class", "category", "group", "major"]],
  ["itemName", ["menu item name", "menu item", "item name", "item description", "product name", "item", "product", "dish", "description"]],
];

const MEASURE_LABELS = {
  netSales: "Sales",
  grossSales: "Gross Sales",
  quantity: "Units Sold",
  discount: "Discounts",
  tax: "Tax",
  cost: "Cost",
  price: "Price",
  checkCount: "Checks",
};

// NL synonyms -> canonical measure role (used by the chat parser).
const MEASURE_SYNONYMS = [
  ["quantity", ["units", "unit", "quantity", "qty", "how many", "number sold", "volume", "count of", "items sold", "sold"]],
  ["netSales", ["net sales", "revenue", "sales", "dollars", "income", "money", "how much", "top line", "total sales", "$"]],
  ["grossSales", ["gross"]],
  ["discount", ["discount", "comp", "comps"]],
  ["checkCount", ["checks", "covers", "transactions", "tickets", "orders"]],
];

// NL synonyms -> canonical dimension role.
const DIM_SYNONYMS = [
  ["daypart", ["daypart", "day part", "meal period", "meal", "service period", "breakfast", "lunch", "dinner", "brunch"]],
  ["menuGroup", ["menu group", "group", "category", "family", "major group", "section", "menu category"]],
  ["itemName", ["item", "menu item", "product", "dish", "sku"]],
  ["__time__", ["over time", "trend", "by day", "daily", "by week", "weekly", "by month", "monthly", "by date", "each day", "time"]],
  ["__period__", ["by quarter", "by period", "quarter over quarter", "period over period", "across quarters", "qoq"]],
];

/* ============================ helpers ============================ */

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

function excelSerialToDate(serial) {
  if (typeof serial !== "number" || !isFinite(serial)) return null;
  // Excel day 0 is 1899-12-30. Serials below ~20000 are not plausible dates here.
  if (serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

function toDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return excelSerialToDate(value);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function coerceNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,%\s]/g, "").replace(/[()]/g, "");
  const neg = /^\(.*\)$/.test(String(v).trim());
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

function normalizeHeader(h) {
  return String(h == null ? "" : h).trim();
}

function matchRole(header) {
  const h = normalizeHeader(header).toLowerCase();
  if (!h) return null;
  for (const [role, keywords] of ROLE_MATCHERS) {
    for (const kw of keywords) {
      if (h.includes(kw)) return role;
    }
  }
  return null;
}

function inferType(values) {
  const sample = values.filter((v) => v != null && v !== "").slice(0, 200);
  if (!sample.length) return "string";
  let numeric = 0;
  let dateish = 0;
  for (const v of sample) {
    if (typeof v === "number") {
      numeric++;
      if (excelSerialToDate(v)) dateish++;
    } else if (v instanceof Date) {
      dateish++;
    } else {
      const s = String(v);
      if (coerceNumber(s) != null && /\d/.test(s) && !/[a-zA-Z]{2,}/.test(s)) numeric++;
      if (/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(s) || !isNaN(Date.parse(s))) {
        if (/[-/:]/.test(s)) dateish++;
      }
    }
  }
  const n = sample.length;
  if (dateish / n > 0.7 && numeric / n < 0.95) return "date";
  if (numeric / n > 0.8) return "number";
  return "string";
}

function buildSchema(rows) {
  if (!rows || !rows.length) return { columns: [], mapping: {} };
  const headers = Object.keys(rows[0]).filter((h) => !h.startsWith("__"));
  const columns = headers.map((name) => {
    const values = rows.map((r) => r[name]);
    const type = inferType(values);
    const nonNull = values.filter((v) => v != null && v !== "");
    const uniq = new Set(nonNull.map((v) => String(v)));
    return {
      name,
      type,
      role: matchRole(name),
      cardinality: uniq.size,
      nullRate: rows.length ? 1 - nonNull.length / rows.length : 1,
      sample: Array.from(uniq).slice(0, 4),
    };
  });

  // Build role -> column map. If two columns claim a role, keep the first.
  const mapping = {};
  for (const col of columns) {
    if (col.role && !mapping[col.role]) mapping[col.role] = col.name;
  }
  // A date role must actually look like a date; otherwise drop it.
  if (mapping.date) {
    const dcol = columns.find((c) => c.name === mapping.date);
    if (dcol && dcol.type !== "date" && dcol.type !== "number") delete mapping.date;
  }
  return { columns, mapping };
}

function isColumnAllZero(rows, field) {
  if (!field) return false;
  let seen = 0;
  for (const r of rows) {
    const n = coerceNumber(r[field]);
    if (n != null) {
      seen++;
      if (n !== 0) return false;
    }
  }
  return seen > 0;
}

/* ============================ data cleaning ============================ */
/*
  POS type-in resolution. A generic beer button ("IPA 1") is rung, then a
  "TYPE IN" line is added whose Reference Information Line 1 holds the real beer.
  This moves that reference into Menu Item Name on the IPA 1 line and drops the
  TYPE IN row, so beer rolls up by actual beer and can join to cost. Scope is
  name-targeted (default "IPA 1"), so nothing else is renamed. Any resolution
  whose text matches a food item name or a kitchen note is flagged for review.
*/
function cleanTransactions(rawRows, opts) {
  opts = opts || {};
  const targets = (opts.targetNames || ["IPA 1"]).map((s) => s.trim().toUpperCase());
  const typeInName = (opts.typeInName || "TYPE IN").toUpperCase();
  const empty = { ipaLines: 0, resolved: 0, deleted: 0, unpaired: [], flagged: [] };
  if (!rawRows || !rawRows.length) return { rows: rawRows || [], summary: empty };

  const m = buildSchema(rawRows).mapping;
  const keys = Object.keys(rawRows[0]);
  const hk = (kw) => keys.find((h) => h.toLowerCase().includes(kw));
  const nameCol = m.itemName || hk("menu item name") || hk("item name");
  const checkCol = m.checkId || hk("check number") || hk("check");
  const refCol = m.refInfo || hk("reference information") || hk("reference");
  const groupCol = m.menuGroup || hk("major group") || hk("group");

  const summary = { ipaLines: 0, resolved: 0, deleted: 0, unpaired: [], flagged: [], nameCol, refCol, checkCol };
  if (!nameCol) {
    summary.skipped = "No Menu Item Name column found";
    return { rows: rawRows, summary };
  }

  const nm = (r) => String(r[nameCol] == null ? "" : r[nameCol]).trim().toUpperCase();
  const isTypeIn = (r) => nm(r) === typeInName;
  const ck = (r) => (checkCol ? String(r[checkCol]) : "__ALL__");

  // Non-beverage item names, used to flag suspicious resolutions (e.g. SALMON).
  const foodNames = new Set();
  if (groupCol) {
    const bev = ["BEER", "WINE", "LIQUOR", "SPIRIT", "COCKTAIL", "NON ALC", "NON-ALC", "BEVERAGE", "BAR"];
    for (const r of rawRows) {
      const g = String(r[groupCol] == null ? "" : r[groupCol]).toUpperCase();
      const name = nm(r);
      if (name && name !== typeInName && !bev.some((x) => g.includes(x))) foodNames.add(name);
    }
  }
  const kitchenPat = /^(86\b|no |sub\b|sub |side |extra |add |light |hold |on side)/i;

  const toDelete = new Set();
  for (let i = 0; i < rawRows.length; i++) {
    if (!targets.includes(nm(rawRows[i]))) continue;
    summary.ipaLines++;
    let paired = false;
    for (let j = i + 1; j < rawRows.length; j++) {
      if (ck(rawRows[j]) !== ck(rawRows[i])) break;
      if (toDelete.has(j)) continue;
      if (isTypeIn(rawRows[j])) {
        const ref = refCol ? String(rawRows[j][refCol] == null ? "" : rawRows[j][refCol]).trim() : "";
        if (ref) {
          rawRows[i] = { ...rawRows[i], [nameCol]: ref };
          toDelete.add(j);
          summary.resolved++;
          summary.deleted++;
          paired = true;
          const up = ref.toUpperCase();
          if (foodNames.has(up) || kitchenPat.test(ref)) {
            summary.flagged.push({ check: ck(rawRows[i]), name: ref, reason: foodNames.has(up) ? "matches a food item name" : "looks like a kitchen note" });
          }
          break;
        }
      }
    }
    if (!paired) summary.unpaired.push(ck(rawRows[i]));
  }
  const rows = rawRows.filter((_, k) => !toDelete.has(k));
  return { rows, summary };
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const currencyFmt2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat("en-US");

function fmtCurrency(n, precise) {
  if (n == null || !isFinite(n)) return "—";
  return precise ? currencyFmt2.format(n) : currencyFmt.format(n);
}
function fmtNumber(n) {
  if (n == null || !isFinite(n)) return "—";
  return numFmt.format(Math.round(n * 100) / 100);
}
function fmtPct(n) {
  if (n == null || !isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}
function fmtDate(d) {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function isCurrencyRole(role) {
  return ["netSales", "grossSales", "discount", "tax", "cost", "price"].includes(role);
}

function bucketDate(d, mode) {
  if (!d) return null;
  if (mode === "month") return d.toISOString().slice(0, 7);
  if (mode === "week") {
    const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - onejan) / 86400000 + onejan.getUTCDay() + 1) / 7);
    return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
  }
  return d.toISOString().slice(0, 10);
}

/* ============================ query core ============================ */
/*
  A QuerySpec is the single source of truth shared by the pivot builder,
  starter views, and chat. executeSpec(spec, rows, mapping) resolves it.

  spec = {
    measureField, measureRole, measureLabel, agg ('sum'|'avg'|'count'|'distinct'),
    groupField, groupRole, groupLabel, groupMode ('value'|'day'|'week'|'month'|'period'),
    filters: [{ field, values }],
    topN, order ('desc'|'asc'), viz ('bar'|'line'|'pie'|'kpi')
  }
*/

function rowMatchesFilters(row, filters, mapping) {
  if (!filters || !filters.length) return true;
  for (const f of filters) {
    const field = f.field || mapping[f.role];
    if (!field) continue;
    const val = row[field];
    const sval = val == null ? "" : String(val);
    if (f.values && f.values.length && !f.values.map(String).includes(sval)) return false;
  }
  return true;
}

function groupKeyFor(row, spec, mapping) {
  if (spec.groupMode === "period") return row.__period || "All";
  if (["day", "week", "month"].includes(spec.groupMode)) {
    const d = toDate(row[mapping.date]);
    return bucketDate(d, spec.groupMode) || "(no date)";
  }
  const v = row[spec.groupField];
  return v == null || v === "" ? "(blank)" : String(v);
}

function aggReducer(agg, field) {
  if (agg === "count") return (rows) => rows.length;
  if (agg === "distinct") return (rows) => new Set(rows.map((r) => String(r[field])).filter((x) => x !== "null" && x !== "")).size;
  const nums = (rows) => rows.map((r) => coerceNumber(r[field])).filter((n) => n != null);
  if (agg === "avg") return (rows) => { const a = nums(rows); return a.length ? _.sum(a) / a.length : 0; };
  return (rows) => _.sum(nums(rows)); // sum
}

function executeSpec(spec, allRows, mapping, globalFilters) {
  const filters = [...(globalFilters || []), ...(spec.filters || [])];
  const rows = allRows.filter((r) => rowMatchesFilters(r, filters, mapping));
  const reduce = aggReducer(spec.agg, spec.measureField);

  if (!spec.groupField && !["day", "week", "month", "period"].includes(spec.groupMode)) {
    return { kind: "kpi", value: reduce(rows), rowCount: rows.length };
  }

  const grouped = _.groupBy(rows, (r) => groupKeyFor(r, spec, mapping));
  let data = Object.entries(grouped).map(([key, rs]) => ({
    key,
    value: reduce(rs),
    count: rs.length,
  }));

  const timeMode = ["day", "week", "month", "period"].includes(spec.groupMode);
  if (timeMode) {
    data.sort((a, b) => (a.key < b.key ? -1 : 1));
  } else {
    data.sort((a, b) => (spec.order === "asc" ? a.value - b.value : b.value - a.value));
  }

  const total = _.sumBy(data, "value") || 0;
  data = data.map((d) => ({ ...d, share: total ? d.value / total : 0 }));

  const limited = spec.topN && !timeMode ? data.slice(0, spec.topN) : data;
  return { kind: "series", data: limited, total, allData: data, timeMode };
}

/* ---- chat interpreter (deterministic brain; swap for LLM later) ---- */

function detectMeasure(q, mapping) {
  for (const [role, syns] of MEASURE_SYNONYMS) {
    if (!mapping[role]) continue;
    for (const s of syns) if (q.includes(s)) return role;
  }
  return null;
}

function detectDimension(q, mapping) {
  for (const [role, syns] of DIM_SYNONYMS) {
    for (const s of syns) {
      if (q.includes(s)) {
        if (role === "__time__") return mapping.date ? { role: "__time__" } : null;
        if (role === "__period__") return { role: "__period__" };
        if (mapping[role]) return { role };
      }
    }
  }
  return null;
}

function detectAgg(q) {
  if (/\b(average|avg|mean|per )/.test(q)) return "avg";
  if (/\b(how many|number of|count of|count)\b/.test(q)) return "count";
  return "sum";
}

function detectFilters(q, ctx) {
  const filters = [];
  for (const role of ["daypart", "menuGroup"]) {
    const field = ctx.mapping[role];
    if (!field) continue;
    const values = (ctx.dimValues[field] || []).filter((v) => q.includes(String(v).toLowerCase()));
    if (values.length) filters.push({ field, values });
  }
  return filters;
}

function interpretQuery(text, ctx) {
  const q = " " + text.toLowerCase().trim() + " ";
  const { mapping, rows } = ctx;

  if (!rows.length) {
    return { type: "cantAnswer", text: "No data is loaded yet. Upload a POS export (xlsx or csv), or click Load sample data to try the tool." };
  }

  // 1) Domain-aware refusals — the part that makes this trustworthy.
  if (/(margin|profit|gross profit|contribution|cogs|food cost|markup|profitab)/.test(q)) {
    const haveCost = mapping.cost && !isColumnAllZero(rows, mapping.cost);
    if (!haveCost) {
      return {
        type: "cantAnswer",
        text:
          "This POS export has no usable cost data (the COGS column is zero or absent), so I can't compute margin or contribution. " +
          "To get it, join Reeco invoice unit costs to Recipe Cards on the item Number, then match to these sales. " +
          "I can show revenue, units, and menu mix right now — try \"net sales by menu group\" or \"top items by revenue.\"",
      };
    }
  }
  if (/(labor|staff|schedul|payroll|clock|wage|hours worked|overtime)/.test(q)) {
    return { type: "cantAnswer", text: "Labor and scheduling aren't in a POS transaction export. That lives in your scheduling/occupancy data. Load that dataset to answer labor questions." };
  }
  if (/(inventory|stock|waste|spoilage|par level|on hand|86'?d|depletion)/.test(q)) {
    return { type: "cantAnswer", text: "Inventory and waste aren't in transaction data. Pull Reeco purchases and counts for that. Here I can only speak to what sold." };
  }
  if (/(forecast|predict|projection|next quarter|will sell|expected|future)/.test(q)) {
    return { type: "cantAnswer", text: "I don't forecast — I report what happened. Load multiple quarters and ask for a trend (\"net sales by month\"), and you can extrapolate from the slope. A real forecast needs a model layer on top." };
  }
  if (/(guest|customer).*(age|gender|demograph|loyalty|repeat|satisfaction|nps|review|rating)/.test(q)) {
    return { type: "cantAnswer", text: "Guest demographics and satisfaction aren't in POS lines. That comes from your CRM/loyalty or survey data." };
  }

  // 2) Parse a spec.
  let measureRole = detectMeasure(q, mapping);
  const agg = detectAgg(q);
  if (!measureRole && agg !== "count") {
    // Default to net sales when a measure is implied but unnamed.
    if (mapping.netSales) measureRole = "netSales";
    else if (mapping.quantity) measureRole = "quantity";
  }
  const measureField = measureRole ? mapping[measureRole] : null;
  if (!measureField && agg !== "count") {
    return {
      type: "cantAnswer",
      text:
        "I couldn't find a metric to measure in this file. Detected measures: " +
        Object.keys(mapping).filter((r) => MEASURE_LABELS[r]).map((r) => MEASURE_LABELS[r]).join(", ") +
        ". Try naming one, e.g. \"units by daypart.\"",
    };
  }

  const dim = detectDimension(q, mapping);
  const topMatch = q.match(/top\s+(\d+)/);
  const bottomMatch = q.match(/bottom\s+(\d+)/);
  const wantsBottom = /\b(bottom|worst|lowest|least)\b/.test(q);
  const wantsShare = /\b(mix|share|percent|percentage|proportion|breakdown|split)\b/.test(q);

  let groupMode = "value";
  let groupField = null;
  let groupRole = null;
  let groupLabel = "";
  if (dim) {
    if (dim.role === "__time__") {
      groupMode = /monthly|by month|each month/.test(q) ? "month" : /weekly|by week/.test(q) ? "week" : "day";
      groupLabel = groupMode[0].toUpperCase() + groupMode.slice(1);
    } else if (dim.role === "__period__") {
      groupMode = "period";
      groupLabel = "Period";
    } else {
      groupField = mapping[dim.role];
      groupRole = dim.role;
      groupLabel = dim.role === "menuGroup" ? "Menu Group" : dim.role === "daypart" ? "Daypart" : dim.role === "itemName" ? "Item" : dim.role;
    }
  }

  let viz = "bar";
  if (groupMode === "day" || groupMode === "week" || groupMode === "month") viz = "line";
  else if (wantsShare) viz = "pie";
  if (/\b(line|trend)\b/.test(q)) viz = "line";
  if (/\b(pie|donut)\b/.test(q)) viz = "pie";
  if (/\b(bar|column|rank)\b/.test(q)) viz = "bar";

  const spec = {
    measureField,
    measureRole,
    measureLabel: measureRole ? MEASURE_LABELS[measureRole] || measureRole : "Count",
    agg: measureField ? agg : "count",
    groupField,
    groupRole,
    groupMode,
    groupLabel,
    filters: detectFilters(q, ctx),
    topN: topMatch ? +topMatch[1] : bottomMatch ? +bottomMatch[1] : dim && groupMode === "value" ? 10 : null,
    order: wantsBottom ? "asc" : "desc",
    viz,
  };

  // 3) Compose a plain-language answer.
  const result = executeSpec(spec, rows, mapping, ctx.globalFilters);
  const filterNote = spec.filters.length
    ? " (filtered to " + spec.filters.map((f) => f.values.join("/")).join(", ") + ")"
    : "";

  if (result.kind === "kpi") {
    const val = spec.measureRole && isCurrencyRole(spec.measureRole) ? fmtCurrency(result.value, true) : fmtNumber(result.value);
    return {
      type: "answer",
      text: `${spec.agg === "avg" ? "Average" : "Total"} ${spec.measureLabel}${filterNote}: ${val} across ${fmtNumber(result.rowCount)} lines.`,
      spec,
      result,
    };
  }

  const top = result.data[0];
  const lead = top
    ? `${spec.measureLabel} by ${spec.groupLabel}${filterNote}. Leader: ${top.key} at ${spec.measureRole && isCurrencyRole(spec.measureRole) ? fmtCurrency(top.value) : fmtNumber(top.value)} (${fmtPct(top.share)} of shown).`
    : "No rows matched.";
  return { type: "answer", text: lead, spec, result };
}

/* ============================ sample data ============================ */

function makeSampleData() {
  // Mirrors the real TDIM schema, including generic IPA 1 + TYPE IN beer pairs
  // and a zeroed COGS column, so cleaning and the margin refusal both demo live.
  const beers = ["MIDAS", "LAGUNITAS IPA", "BOZEMAN PALE", "406 SESSION", "GUINNESS", "MODELO"];
  const foods = [
    ["BISON BURGER", "BISTRO CLASSICS", 17],
    ["TROUT PLATE", "BISTRO CLASSICS", 15.5],
    ["HUMMUS", "SOCIAL SNACKS", 11],
    ["CHICKEN BOWL", "BISTRO CLASSICS", 14],
    ["FRIES", "MODIFIERS", 0],
    ["ALMONDS", "GRAB N GO", 2.5],
    ["SALMON", "BISTRO CLASSICS", 19],
  ];
  const wines = [["CH SIMI CHARD", "GLASS WHITE 8 OZ", 15.5], ["HOUSE RED", "GLASS RED 8 OZ", 12]];
  const nonalc = [["SAN PELLEGRINO", "BEV NON ALCOHOL", 6.5], ["DRIP COFFEE", "BEV NON ALCOHOL", 3.5]];
  const dayparts = ["Breakfast", "Lunch", "PM Snack", "Dinner"];
  const num = { "IPA 1": 4400027, "TYPE IN": 5050016 };
  let nextNo = 4090000;
  const noFor = (n) => num[n] || (num[n] = ++nextNo);
  const rows = [];
  let check = 6800;
  const start = Date.UTC(2026, 3, 1);
  const mk = (date, ck, name, no, total, ref, dp, qh, major, family) => ({
    "Transaction Date and Time": date,
    "Check Number": ck,
    "Menu Item Name": name,
    "Menu Item Number": no,
    "Check Line Total": total,
    "Reference Information Line 1": ref,
    "Cost of Goods Sold Amount": 0,
    "Day Part Name": dp,
    "Quarter Hour": qh,
    "Major Group Name": major,
    "Family Group Name": family,
  });
  for (let day = 0; day < 91; day++) {
    const date = new Date(start + day * 86400000);
    const dow = date.getUTCDay();
    const checksToday = (dow === 5 || dow === 6 ? 30 : 20) + Math.floor(Math.random() * 12);
    for (let c = 0; c < checksToday; c++) {
      check++;
      const dp = dayparts[Math.floor(Math.random() * dayparts.length)];
      const hr = 7 + Math.floor(Math.random() * 15);
      const qh = String(hr).padStart(2, "0") + ":" + ["00", "15", "30", "45"][Math.floor(Math.random() * 4)];
      const lines = 1 + Math.floor(Math.random() * 5);
      for (let l = 0; l < lines; l++) {
        const roll = Math.random();
        if (roll < 0.28) {
          rows.push(mk(date, check, "IPA 1", num["IPA 1"], 7.0, "", dp, qh, "BEER", "BEER REGIONAL CRAFT"));
          const ref = Math.random() < 0.08 ? "SALMON" : beers[Math.floor(Math.random() * beers.length)];
          rows.push(mk(date, check, "TYPE IN", num["TYPE IN"], 0.0, ref, dp, qh, "FOOD", "MODIFIERS"));
        } else if (roll < 0.42) {
          const w = wines[Math.floor(Math.random() * wines.length)];
          rows.push(mk(date, check, w[0], noFor(w[0]), w[2], "", dp, qh, "WINE", w[1]));
        } else if (roll < 0.58) {
          const nz = nonalc[Math.floor(Math.random() * nonalc.length)];
          rows.push(mk(date, check, nz[0], noFor(nz[0]), nz[2], "", dp, qh, "NON ALC", nz[1]));
        } else {
          const f = foods[Math.floor(Math.random() * foods.length)];
          rows.push(mk(date, check, f[0], noFor(f[0]), f[2], "", dp, qh, "FOOD", f[1]));
        }
      }
    }
  }
  return rows;
}

/* ============================ UI atoms ============================ */

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-slate-800 mt-1">{value}</div>
      {sub ? <div className="text-xs text-slate-400 mt-1">{sub}</div> : null}
    </div>
  );
}

function Panel({ title, right, children }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "text-xs px-2 py-1 rounded-full border transition-colors",
        active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"
      )}
    >
      {children}
    </button>
  );
}

function Chart({ result, spec }) {
  if (!result || result.kind !== "series" || !result.data.length) {
    return <div className="text-sm text-slate-400 py-8 text-center">No chart for this result.</div>;
  }
  const money = spec.measureRole && isCurrencyRole(spec.measureRole);
  const fmtVal = (v) => (money ? fmtCurrency(v) : fmtNumber(v));
  const data = result.data.map((d) => ({ name: d.key, value: Math.round(d.value * 100) / 100, share: d.share }));

  if (spec.viz === "line") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtVal} width={70} />
          <Tooltip formatter={fmtVal} />
          <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} name={spec.measureLabel} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (spec.viz === "pie") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => e.name}>
            {data.map((_e, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={fmtVal} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={data.length > 6 ? -20 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 60 : 30} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtVal} width={70} />
        <Tooltip formatter={fmtVal} />
        <Bar dataKey="value" name={spec.measureLabel} radius={[3, 3, 0, 0]}>
          {data.map((_e, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ResultTable({ result, spec }) {
  if (!result || result.kind !== "series" || !result.data.length) return null;
  const money = spec.measureRole && isCurrencyRole(spec.measureRole);
  return (
    <div className="overflow-auto max-h-72 mt-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-1 pr-4 font-medium">{spec.groupLabel}</th>
            <th className="py-1 pr-4 font-medium text-right">{spec.measureLabel}</th>
            <th className="py-1 pr-4 font-medium text-right">Share</th>
            <th className="py-1 font-medium text-right">Lines</th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((d, i) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="py-1 pr-4 text-slate-700">{d.key}</td>
              <td className="py-1 pr-4 text-right text-slate-800 font-medium">{money ? fmtCurrency(d.value) : fmtNumber(d.value)}</td>
              <td className="py-1 pr-4 text-right text-slate-500">{fmtPct(d.share)}</td>
              <td className="py-1 text-right text-slate-400">{fmtNumber(d.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ main component ============================ */

export default function FBTransactionExplorer() {
  const [datasets, setDatasets] = useState([]); // {id,name,rows}
  const [error, setError] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [globalFilters, setGlobalFilters] = useState([]); // {field, values}
  const [mappingOverride, setMappingOverride] = useState({});
  const [savedViews, setSavedViews] = useState([]);
  const [chat, setChat] = useState([
    { role: "assistant", text: "Ask me about your transactions — e.g. \"net sales by menu group\", \"top 10 items by units\", \"lunch revenue by day\". I'll tell you when the data can't answer and what you'd need." },
  ]);
  const [chatInput, setChatInput] = useState("");

  // Pivot builder config
  const [pivot, setPivot] = useState({ measureRole: "netSales", agg: "sum", groupRole: "menuGroup", groupMode: "value", viz: "bar", topN: 10 });
  const [hideModifiers, setHideModifiers] = useState(true);
  const [showFlagged, setShowFlagged] = useState(false);

  const fileRef = useRef(null);
  const viewsRef = useRef(null);

  const rawRows = useMemo(() => {
    const out = [];
    for (const ds of datasets) for (const r of ds.rows) out.push({ ...r, __period: ds.name });
    return out;
  }, [datasets]);

  const autoSchema = useMemo(() => buildSchema(rawRows), [rawRows]);
  const mapping = useMemo(() => ({ ...autoSchema.mapping, ...mappingOverride }), [autoSchema, mappingOverride]);

  const rows = useMemo(() => {
    if (!hideModifiers || !mapping.itemName) return rawRows;
    const nameCol = mapping.itemName;
    return rawRows.filter((r) => String(r[nameCol] == null ? "" : r[nameCol]).trim().toUpperCase() !== "TYPE IN");
  }, [rawRows, hideModifiers, mapping]);

  const cleaningSummary = useMemo(() => {
    const agg = { resolved: 0, deleted: 0, ipaLines: 0, unpaired: 0, flagged: [] };
    for (const ds of datasets) {
      const s = ds.summary;
      if (!s) continue;
      agg.resolved += s.resolved || 0;
      agg.deleted += s.deleted || 0;
      agg.ipaLines += s.ipaLines || 0;
      agg.unpaired += s.unpaired ? s.unpaired.length : 0;
      if (s.flagged) for (const f of s.flagged) agg.flagged.push(f);
    }
    return agg;
  }, [datasets]);

  const dimValues = useMemo(() => {
    const dv = {};
    for (const role of ["daypart", "menuGroup"]) {
      const f = mapping[role];
      if (f) dv[f] = _.uniq(rows.map((r) => (r[f] == null ? "" : String(r[f]))).filter(Boolean)).slice(0, 50).map((s) => s.toLowerCase());
    }
    return dv;
  }, [rows, mapping]);

  const filteredRows = useMemo(() => rows.filter((r) => rowMatchesFilters(r, globalFilters, mapping)), [rows, globalFilters, mapping]);

  /* ---------- KPIs ---------- */
  const kpis = useMemo(() => {
    const r = filteredRows;
    const netField = mapping.netSales;
    const qtyField = mapping.quantity;
    const net = netField ? _.sumBy(r, (x) => coerceNumber(x[netField]) || 0) : null;
    const qty = qtyField ? _.sumBy(r, (x) => coerceNumber(x[qtyField]) || 0) : null;
    const items = mapping.itemNumber || mapping.itemName;
    const distinct = items ? new Set(r.map((x) => String(x[items])).filter((v) => v && v !== "null")).size : null;
    const dates = mapping.date ? r.map((x) => toDate(x[mapping.date])).filter(Boolean) : [];
    let minT = null;
    let maxT = null;
    for (const d of dates) {
      const t = d.getTime();
      if (minT == null || t < minT) minT = t;
      if (maxT == null || t > maxT) maxT = t;
    }
    const minD = minT == null ? null : new Date(minT);
    const maxD = maxT == null ? null : new Date(maxT);
    return {
      net,
      qty,
      lines: r.length,
      distinct,
      avgLine: net != null && r.length ? net / r.length : null,
      span: minD && maxD ? fmtDate(minD) + " → " + fmtDate(maxD) : "—",
    };
  }, [filteredRows, mapping]);

  /* ---------- file ingestion ---------- */
  function ingestRows(name, raw, summary) {
    if (!raw || !raw.length) throw new Error("No rows found in " + name);
    setDatasets((prev) => {
      const base = name.replace(/\.(xlsx|xls|csv)$/i, "");
      let label = base;
      let n = 2;
      const taken = new Set(prev.map((d) => d.name));
      while (taken.has(label)) label = base + " (" + n++ + ")";
      return [...prev, { id: Date.now() + Math.random(), name: label, rows: raw, summary: summary || null }];
    });
  }

  function handleFiles(e) {
    setError("");
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          if (/\.csv$/i.test(file.name)) {
            const parsed = Papa.parse(ev.target.result, { header: true, dynamicTyping: true, skipEmptyLines: true });
            const cleaned = cleanTransactions(parsed.data, {});
            ingestRows(file.name, cleaned.rows, cleaned.summary);
          } else {
            const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(ws, { defval: null });
            const cleaned = cleanTransactions(json, {});
            ingestRows(file.name, cleaned.rows, cleaned.summary);
          }
        } catch (err) {
          setError("Could not read " + file.name + ": " + err.message);
        }
      };
      reader.onerror = () => setError("Failed to read " + file.name);
      if (/\.csv$/i.test(file.name)) reader.readAsText(file);
      else reader.readAsArrayBuffer(file);
    });
    e.target.value = "";
  }

  function loadSample() {
    setError("");
    const cleaned = cleanTransactions(makeSampleData(), {});
    ingestRows("Sample Q2 2026", cleaned.rows, cleaned.summary);
  }

  function removeDataset(id) {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
  }

  /* ---------- filters ---------- */
  function toggleFilter(field, value) {
    setGlobalFilters((prev) => {
      const existing = prev.find((f) => f.field === field);
      if (!existing) return [...prev, { field, values: [value] }];
      const has = existing.values.includes(value);
      const values = has ? existing.values.filter((v) => v !== value) : [...existing.values, value];
      const next = prev.filter((f) => f.field !== field);
      return values.length ? [...next, { field, values }] : next;
    });
  }
  function isFilterActive(field, value) {
    const f = globalFilters.find((x) => x.field === field);
    return f ? f.values.includes(value) : false;
  }

  /* ---------- pivot spec ---------- */
  const pivotSpec = useMemo(() => {
    const groupIsTime = ["day", "week", "month", "period"].includes(pivot.groupMode);
    return {
      measureField: pivot.agg === "count" ? null : mapping[pivot.measureRole],
      measureRole: pivot.agg === "count" ? null : pivot.measureRole,
      measureLabel: pivot.agg === "count" ? "Line Count" : MEASURE_LABELS[pivot.measureRole] || pivot.measureRole,
      agg: pivot.agg,
      groupField: groupIsTime ? null : mapping[pivot.groupRole],
      groupRole: groupIsTime ? null : pivot.groupRole,
      groupMode: pivot.groupMode,
      groupLabel: pivot.groupMode === "period" ? "Period" : ["day", "week", "month"].includes(pivot.groupMode) ? pivot.groupMode : (pivot.groupRole === "menuGroup" ? "Menu Group" : pivot.groupRole === "daypart" ? "Daypart" : pivot.groupRole === "itemName" ? "Item" : pivot.groupRole),
      filters: [],
      topN: groupIsTime ? null : pivot.topN,
      order: "desc",
      viz: pivot.viz,
    };
  }, [pivot, mapping]);

  const pivotResult = useMemo(() => {
    if (!rows.length || (!pivotSpec.measureField && pivotSpec.agg !== "count")) return null;
    try {
      return executeSpec(pivotSpec, rows, mapping, globalFilters);
    } catch (e) {
      return null;
    }
  }, [pivotSpec, rows, mapping, globalFilters]);

  /* ---------- starter views ---------- */
  const starterSpecs = useMemo(() => {
    const specs = {};
    if (mapping.daypart) specs.daypart = { measureField: mapping.netSales, measureRole: "netSales", measureLabel: "Sales", agg: "sum", groupField: mapping.daypart, groupRole: "daypart", groupMode: "value", groupLabel: "Daypart", filters: [], topN: null, order: "desc", viz: "bar" };
    if (mapping.menuGroup) specs.menuGroup = { measureField: mapping.netSales, measureRole: "netSales", measureLabel: "Sales", agg: "sum", groupField: mapping.menuGroup, groupRole: "menuGroup", groupMode: "value", groupLabel: "Menu Group", filters: [], topN: 12, order: "desc", viz: "bar" };
    const itemField = mapping.itemName || mapping.itemNumber;
    if (itemField) specs.item = { measureField: mapping.quantity || mapping.netSales, measureRole: mapping.quantity ? "quantity" : "netSales", measureLabel: mapping.quantity ? "Units Sold" : "Sales", agg: "sum", groupField: itemField, groupRole: "itemName", groupMode: "value", groupLabel: "Item", filters: [], topN: 15, order: "desc", viz: "bar" };
    return specs;
  }, [mapping]);

  /* ---------- saved views ---------- */
  function saveView(name, spec, source) {
    setSavedViews((prev) => [...prev, { id: Date.now() + Math.random(), name, spec, source }]);
  }
  function loadView(v) {
    if (v.spec.groupMode === "period" || ["day", "week", "month"].includes(v.spec.groupMode)) {
      setPivot({ measureRole: v.spec.measureRole || "netSales", agg: v.spec.agg, groupRole: "menuGroup", groupMode: v.spec.groupMode, viz: v.spec.viz, topN: v.spec.topN || 10 });
    } else {
      setPivot({ measureRole: v.spec.measureRole || "netSales", agg: v.spec.agg, groupRole: v.spec.groupRole || "menuGroup", groupMode: "value", viz: v.spec.viz, topN: v.spec.topN || 10 });
    }
    setTab("explore");
  }
  function exportViews() {
    const blob = new Blob([JSON.stringify({ savedViews, mappingOverride }, null, 2)], { type: "application/json" });
    downloadBlob(blob, "fb_explorer_views.json");
  }
  function importViews(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed.savedViews) setSavedViews(parsed.savedViews);
        if (parsed.mappingOverride) setMappingOverride(parsed.mappingOverride);
      } catch (err) {
        setError("Bad views file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportCSV(result, spec) {
    if (!result || result.kind !== "series") return;
    const header = [spec.groupLabel, spec.measureLabel, "Share", "Lines"];
    const lines = [header.join(",")].concat(
      result.data.map((d) => [JSON.stringify(d.key), d.value, (d.share * 100).toFixed(2) + "%", d.count].join(","))
    );
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), "export.csv");
  }

  /* ---------- chat ---------- */
  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const ctx = { mapping, rows: filteredRows, dimValues, globalFilters: [] };
    const res = interpretQuery(text, ctx);
    setChat((prev) => [...prev, { role: "user", text }, { role: "assistant", ...res }]);
    setChatInput("");
  }

  /* ---------- render ---------- */
  const hasData = rows.length > 0;
  const measureRoles = Object.keys(MEASURE_LABELS).filter((r) => mapping[r]);
  const dimRoles = ["daypart", "menuGroup", "familyGroup", "itemName"].filter((r) => mapping[r]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      {/* Header */}
      <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
        <div>
          <div className="text-base font-bold">F&amp;B Transaction Explorer</div>
          <div className="text-xs text-slate-400">POS analytics · Courtyard Marriott · BI module (v1)</div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleFiles} className="hidden" />
          <button onClick={() => fileRef.current && fileRef.current.click()} className="text-sm bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-md font-medium">
            Upload data
          </button>
          {!hasData && (
            <button onClick={loadSample} className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-md">
              Load sample data
            </button>
          )}
        </div>
      </div>

      {error ? <div className="bg-rose-50 text-rose-700 text-sm px-5 py-2 border-b border-rose-200">{error}</div> : null}

      <div className="flex">
        {/* Left rail */}
        <aside className="w-64 shrink-0 bg-white border-r border-slate-200 min-h-screen p-3 space-y-4">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Data sources</div>
            {datasets.length === 0 ? (
              <div className="text-xs text-slate-400">None loaded.</div>
            ) : (
              <div className="space-y-1">
                {datasets.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm bg-slate-50 rounded px-2 py-1">
                    <span className="truncate text-slate-700">{d.name}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">{d.rows.length}</span>
                      <button onClick={() => removeDataset(d.id)} className="text-slate-400 hover:text-rose-500 text-xs">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {hasData && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Field mapping</div>
              <div className="space-y-1.5">
                {["date", "checkId", "daypart", "menuGroup", "familyGroup", "itemName", "itemNumber", "refInfo", "netSales", "cost"].map((role) => (
                  <div key={role} className="text-xs">
                    <div className="text-slate-500">{role}</div>
                    <select
                      value={mapping[role] || ""}
                      onChange={(e) => setMappingOverride((m) => ({ ...m, [role]: e.target.value }))}
                      className="w-full border border-slate-200 rounded px-1 py-0.5 text-slate-700 bg-white"
                    >
                      <option value="">— none —</option>
                      {autoSchema.columns.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {mapping.cost && isColumnAllZero(rows, mapping.cost) ? (
                <div className="text-xs text-amber-600 mt-2">Cost column is all zeros. Margin needs Reeco costs.</div>
              ) : null}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-slate-500 uppercase">Saved views</div>
              <div className="flex gap-1">
                <button onClick={exportViews} title="Export" className="text-xs text-slate-400 hover:text-slate-600">⤓</button>
                <input ref={viewsRef} type="file" accept=".json" onChange={importViews} className="hidden" />
                <button onClick={() => viewsRef.current && viewsRef.current.click()} title="Import" className="text-xs text-slate-400 hover:text-slate-600">⤒</button>
              </div>
            </div>
            {savedViews.length === 0 ? (
              <div className="text-xs text-slate-400">Save a chart or chat answer to pin it here.</div>
            ) : (
              <div className="space-y-1">
                {savedViews.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-sm bg-slate-50 rounded px-2 py-1">
                    <button onClick={() => loadView(v)} className="truncate text-indigo-600 hover:underline text-left">{v.name}</button>
                    <button onClick={() => setSavedViews((p) => p.filter((x) => x.id !== v.id))} className="text-slate-400 hover:text-rose-500 text-xs">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 p-4 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-200">
            {[
              ["dashboard", "Dashboard"],
              ["explore", "Explore"],
              ["chat", "Assistant"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cx("px-4 py-2 text-sm font-medium border-b-2 -mb-px", tab === id ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700")}
              >
                {label}
              </button>
            ))}
          </div>

          {!hasData ? (
            <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
              <div className="text-lg font-semibold text-slate-700">No data loaded</div>
              <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                Upload a POS export (TDIM_26Q2.xlsx) or a CSV. The tool auto-detects dates, dimensions, and measures, and maps common F&amp;B fields. You can correct the mapping on the left.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button onClick={() => fileRef.current && fileRef.current.click()} className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md font-medium">Upload data</button>
                <button onClick={loadSample} className="text-sm bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-md">Load sample data</button>
              </div>
            </div>
          ) : (
            <>
              {/* Filters bar */}
              <div className="bg-white rounded-lg border border-slate-200 p-3 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-slate-500 uppercase">Filters</span>
                {["daypart", "menuGroup"].map((role) =>
                  mapping[role] ? (
                    <div key={role} className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs text-slate-400">{role}:</span>
                      {_.uniq(rows.map((r) => String(r[mapping[role]])).filter((v) => v && v !== "null")).slice(0, 8).map((v) => (
                        <Pill key={v} active={isFilterActive(mapping[role], v)} onClick={() => toggleFilter(mapping[role], v)}>{v}</Pill>
                      ))}
                    </div>
                  ) : null
                )}
                {datasets.length > 1 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-slate-400">period:</span>
                    {datasets.map((d) => (
                      <Pill key={d.id} active={isFilterActive("__period", d.name)} onClick={() => toggleFilter("__period", d.name)}>{d.name}</Pill>
                    ))}
                  </div>
                )}
                <label className="text-xs text-slate-500 flex items-center gap-1 ml-auto">
                  <input type="checkbox" checked={hideModifiers} onChange={(e) => setHideModifiers(e.target.checked)} />
                  Hide 0.00 modifier lines
                </label>
                {globalFilters.length > 0 && (
                  <button onClick={() => setGlobalFilters([])} className="text-xs text-rose-500 hover:underline">Clear</button>
                )}
              </div>

              {/* Cleaning report */}
              {(cleaningSummary.resolved > 0 || cleaningSummary.flagged.length > 0 || cleaningSummary.unpaired > 0) && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-emerald-800">
                      Cleaning applied: <b>{cleaningSummary.resolved}</b> IPA 1 line(s) renamed to the specific beer, <b>{cleaningSummary.deleted}</b> TYPE IN row(s) removed.
                      {cleaningSummary.unpaired ? <span className="text-emerald-700"> {cleaningSummary.unpaired} IPA 1 line(s) had no type-in and kept their name.</span> : null}
                    </div>
                    {cleaningSummary.flagged.length > 0 && (
                      <button onClick={() => setShowFlagged((s) => !s)} className="text-amber-700 hover:underline text-xs whitespace-nowrap">
                        {cleaningSummary.flagged.length} flagged, {showFlagged ? "hide" : "review"}
                      </button>
                    )}
                  </div>
                  {showFlagged && cleaningSummary.flagged.length > 0 && (
                    <div className="mt-2 bg-white rounded border border-amber-200 p-2 max-h-40 overflow-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="pr-3 font-medium">Check</th>
                            <th className="pr-3 font-medium">Renamed to</th>
                            <th className="font-medium">Why flagged</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cleaningSummary.flagged.map((f, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="pr-3 text-slate-600">{f.check}</td>
                              <td className="pr-3 text-slate-800">{f.name}</td>
                              <td className="text-amber-700">{f.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <KpiCard label="Sales" value={fmtCurrency(kpis.net)} />
                <KpiCard label="Units" value={fmtNumber(kpis.qty)} />
                <KpiCard label="Lines" value={fmtNumber(kpis.lines)} />
                <KpiCard label="Distinct items" value={fmtNumber(kpis.distinct)} />
                <KpiCard label="Avg $/line" value={fmtCurrency(kpis.avgLine, true)} />
                <KpiCard label="Date span" value={<span className="text-xs">{kpis.span}</span>} />
              </div>

              {tab === "dashboard" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {starterSpecs.daypart && (
                    <StarterView title="Daypart trends" spec={starterSpecs.daypart} rows={rows} mapping={mapping} globalFilters={globalFilters} onSave={saveView} onCSV={exportCSV} />
                  )}
                  {starterSpecs.menuGroup && (
                    <StarterView title="Menu-group performance" spec={starterSpecs.menuGroup} rows={rows} mapping={mapping} globalFilters={globalFilters} onSave={saveView} onCSV={exportCSV} />
                  )}
                  {starterSpecs.item && (
                    <div className="lg:col-span-2">
                      <StarterView title="Item leaderboard" spec={starterSpecs.item} rows={rows} mapping={mapping} globalFilters={globalFilters} onSave={saveView} onCSV={exportCSV} />
                    </div>
                  )}
                </div>
              )}

              {tab === "explore" && (
                <Panel
                  title="Pivot explorer"
                  right={
                    pivotResult && pivotResult.kind === "series" ? (
                      <div className="flex gap-2">
                        <button onClick={() => exportCSV(pivotResult, pivotSpec)} className="text-xs text-slate-500 hover:text-slate-700">Export CSV</button>
                        <button onClick={() => saveView(pivotSpec.measureLabel + " by " + pivotSpec.groupLabel, pivotSpec, "pivot")} className="text-xs text-indigo-600 hover:underline">Save view</button>
                      </div>
                    ) : null
                  }
                >
                  <div className="flex flex-wrap gap-3 mb-4">
                    <LabeledSelect label="Measure" value={pivot.measureRole} onChange={(v) => setPivot((p) => ({ ...p, measureRole: v }))} options={measureRoles.map((r) => [r, MEASURE_LABELS[r]])} />
                    <LabeledSelect label="Aggregate" value={pivot.agg} onChange={(v) => setPivot((p) => ({ ...p, agg: v }))} options={[["sum", "Sum"], ["avg", "Average"], ["count", "Line count"], ["distinct", "Distinct"]]} />
                    <LabeledSelect label="Group by" value={pivot.groupMode === "value" ? pivot.groupRole : pivot.groupMode} onChange={(v) => {
                      if (["day", "week", "month", "period"].includes(v)) setPivot((p) => ({ ...p, groupMode: v }));
                      else setPivot((p) => ({ ...p, groupMode: "value", groupRole: v }));
                    }} options={[...dimRoles.map((r) => [r, r === "menuGroup" ? "Menu Group" : r === "daypart" ? "Daypart" : r === "familyGroup" ? "Family Group" : "Item"]), ...(mapping.date ? [["day", "Day"], ["week", "Week"], ["month", "Month"]] : []), ...(datasets.length > 1 ? [["period", "Period"]] : [])]} />
                    <LabeledSelect label="Chart" value={pivot.viz} onChange={(v) => setPivot((p) => ({ ...p, viz: v }))} options={[["bar", "Bar"], ["line", "Line"], ["pie", "Pie"]]} />
                    <LabeledSelect label="Top N" value={String(pivot.topN)} onChange={(v) => setPivot((p) => ({ ...p, topN: +v }))} options={[["5", "5"], ["10", "10"], ["15", "15"], ["25", "25"], ["1000", "All"]]} />
                  </div>
                  <Chart result={pivotResult} spec={pivotSpec} />
                  <ResultTable result={pivotResult} spec={pivotSpec} />
                </Panel>
              )}

              {tab === "chat" && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 flex flex-col" style={{ height: 560 }}>
                    <div className="flex-1 overflow-auto p-4 space-y-3">
                      {chat.map((m, i) => (
                        <ChatBubble key={i} m={m} onSave={saveView} onCSV={exportCSV} />
                      ))}
                    </div>
                    <div className="border-t border-slate-100 p-3 flex gap-2">
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendChat()}
                        placeholder="Ask: net sales by menu group, top 10 items by units, lunch revenue by day..."
                        className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm"
                      />
                      <button onClick={sendChat} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md text-sm font-medium">Ask</button>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Try</div>
                    <div className="space-y-1.5">
                      {["net sales by menu group", "top 10 items by units", "revenue by daypart", "net sales by day", "lunch sales by menu group", "what's my margin?"].map((s) => (
                        <button key={s} onClick={() => { setChatInput(s); }} className="block w-full text-left text-sm text-indigo-600 hover:bg-slate-50 rounded px-2 py-1">{s}</button>
                      ))}
                    </div>
                    <div className="text-xs text-slate-400 mt-4">The assistant is a deterministic engine in v1. It reports what the data supports and flags what it can't answer. Swap it for a live model when this moves to a backend.</div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/* ============================ sub-components ============================ */

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <label className="text-xs text-slate-500">
      <div className="mb-1">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm text-slate-700 bg-white">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function StarterView({ title, spec, rows, mapping, globalFilters, onSave, onCSV }) {
  const result = useMemo(() => {
    try {
      return executeSpec(spec, rows, mapping, globalFilters);
    } catch (e) {
      return null;
    }
  }, [spec, rows, mapping, globalFilters]);
  return (
    <Panel
      title={title}
      right={
        <div className="flex gap-2">
          <button onClick={() => onCSV(result, spec)} className="text-xs text-slate-500 hover:text-slate-700">CSV</button>
          <button onClick={() => onSave(title, spec, "starter")} className="text-xs text-indigo-600 hover:underline">Save</button>
        </div>
      }
    >
      <Chart result={result} spec={spec} />
      <ResultTable result={result} spec={spec} />
    </Panel>
  );
}

function ChatBubble({ m, onSave, onCSV }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm max-w-lg">{m.text}</div>
      </div>
    );
  }
  const isCant = m.type === "cantAnswer";
  return (
    <div className="flex justify-start">
      <div className={cx("rounded-lg px-3 py-2 text-sm max-w-full w-full", isCant ? "bg-amber-50 border border-amber-200 text-amber-800" : "bg-slate-100 text-slate-700")}>
        <div>{m.text}</div>
        {m.result && m.result.kind === "series" ? (
          <div className="mt-3 bg-white rounded border border-slate-200 p-3">
            <Chart result={m.result} spec={m.spec} />
            <ResultTable result={m.result} spec={m.spec} />
            <div className="flex gap-3 mt-2">
              <button onClick={() => onCSV(m.result, m.spec)} className="text-xs text-slate-500 hover:text-slate-700">Export CSV</button>
              <button onClick={() => onSave((m.spec.measureLabel + " by " + m.spec.groupLabel), m.spec, "chat")} className="text-xs text-indigo-600 hover:underline">Save as view</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
