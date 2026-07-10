import { useMemo, useRef, useState } from "react";
import _ from "lodash";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { MEASURE_LABELS, ROLE_LABELS } from "../lib/constants";
import { cleanTransactions } from "../lib/clean";
import { interpretQuery } from "../lib/chat";
import {
  coerceNumber,
  cx,
  downloadBlob,
  fmtCurrency,
  fmtDate,
  fmtNumber,
  isColumnAllZero,
  toDate,
} from "../lib/helpers";
import { executeSpec, rowMatchesFilters } from "../lib/query";
import { makeSampleData } from "../lib/sampleData";
import { buildSchema } from "../lib/schema";
import {
  Chart,
  ChatBubble,
  KpiCard,
  LabeledSelect,
  Panel,
  Pill,
  ResultTable,
  StarterView,
} from "./ui";

function dimLabel(role) {
  if (role === "menuGroup") return "Menu Group";
  if (role === "daypart") return "Daypart";
  if (role === "itemName") return "Item";
  if (role === "familyGroup") return "Family Group";
  return ROLE_LABELS[role] || role;
}

export default function FBTransactionExplorer() {
  const [datasets, setDatasets] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [globalFilters, setGlobalFilters] = useState([]);
  const [mappingOverride, setMappingOverride] = useState({});
  const [savedViews, setSavedViews] = useState([]);
  const [chat, setChat] = useState([
    {
      role: "assistant",
      text: 'Ask me about your transactions — e.g. "net sales by menu group", "top 10 items by sales", "lunch revenue by day". I\'ll tell you when the data can\'t answer and what you\'d need.',
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [pivot, setPivot] = useState({
    measureRole: "netSales",
    agg: "sum",
    groupRole: "menuGroup",
    groupMode: "value",
    viz: "bar",
    topN: 10,
  });
  const [hideModifiers, setHideModifiers] = useState(true);
  const [showFlagged, setShowFlagged] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

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
    for (const role of ["daypart", "menuGroup", "familyGroup"]) {
      const f = mapping[role];
      if (f) {
        dv[f] = _.uniq(rows.map((r) => (r[f] == null ? "" : String(r[f]))).filter(Boolean))
          .slice(0, 80)
          .map((s) => s.toLowerCase());
      }
    }
    return dv;
  }, [rows, mapping]);

  const filteredRows = useMemo(
    () => rows.filter((r) => rowMatchesFilters(r, globalFilters, mapping)),
    [rows, globalFilters, mapping]
  );

  const kpis = useMemo(() => {
    const r = filteredRows;
    const netField = mapping.netSales;
    const qtyField = mapping.quantity;
    const checkField = mapping.checkId;
    const net = netField ? _.sumBy(r, (x) => coerceNumber(x[netField]) || 0) : null;
    const qty = qtyField ? _.sumBy(r, (x) => coerceNumber(x[qtyField]) || 0) : null;
    const checks = checkField
      ? new Set(r.map((x) => String(x[checkField])).filter((v) => v && v !== "null")).size
      : null;
    const items = mapping.itemNumber || mapping.itemName;
    const distinct = items
      ? new Set(r.map((x) => String(x[items])).filter((v) => v && v !== "null")).size
      : null;
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
    const avgCheck = net != null && checks ? net / checks : null;
    return {
      net,
      qty,
      lines: r.length,
      distinct,
      checks,
      avgLine: net != null && r.length ? net / r.length : null,
      avgCheck,
      span: minD && maxD ? fmtDate(minD) + " → " + fmtDate(maxD) : "—",
    };
  }, [filteredRows, mapping]);

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
            const parsed = Papa.parse(ev.target.result, {
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true,
            });
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
      groupLabel:
        pivot.groupMode === "period"
          ? "Period"
          : ["day", "week", "month"].includes(pivot.groupMode)
            ? pivot.groupMode
            : dimLabel(pivot.groupRole),
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
    } catch {
      return null;
    }
  }, [pivotSpec, rows, mapping, globalFilters]);

  const starterSpecs = useMemo(() => {
    const specs = {};
    const salesField = mapping.netSales;
    const itemField = mapping.itemName || mapping.itemNumber;
    const measureField = mapping.quantity || salesField;
    const measureRole = mapping.quantity ? "quantity" : "netSales";
    const measureLabel = mapping.quantity ? "Units Sold" : "Sales";

    if (mapping.daypart && salesField) {
      specs.daypart = {
        measureField: salesField,
        measureRole: "netSales",
        measureLabel: "Sales",
        agg: "sum",
        groupField: mapping.daypart,
        groupRole: "daypart",
        groupMode: "value",
        groupLabel: "Daypart",
        filters: [],
        topN: null,
        order: "desc",
        viz: "bar",
      };
    }
    if (mapping.menuGroup && salesField) {
      specs.menuGroup = {
        measureField: salesField,
        measureRole: "netSales",
        measureLabel: "Sales",
        agg: "sum",
        groupField: mapping.menuGroup,
        groupRole: "menuGroup",
        groupMode: "value",
        groupLabel: "Menu Group",
        filters: [],
        topN: 12,
        order: "desc",
        viz: "bar",
      };
    }
    if (itemField && measureField) {
      specs.item = {
        measureField,
        measureRole,
        measureLabel,
        agg: "sum",
        groupField: itemField,
        groupRole: "itemName",
        groupMode: "value",
        groupLabel: "Item",
        filters: [],
        topN: 15,
        order: "desc",
        viz: "bar",
      };
    }
    if (mapping.date && salesField) {
      specs.trend = {
        measureField: salesField,
        measureRole: "netSales",
        measureLabel: "Sales",
        agg: "sum",
        groupField: null,
        groupRole: null,
        groupMode: "day",
        groupLabel: "Day",
        filters: [],
        topN: null,
        order: "asc",
        viz: "line",
      };
    }
    if (mapping.menuGroup && itemField && salesField) {
      const beerValues = _.uniq(
        rows
          .map((r) => String(r[mapping.menuGroup] || ""))
          .filter((v) => /beer/i.test(v))
      );
      if (beerValues.length) {
        specs.beer = {
          measureField: salesField,
          measureRole: "netSales",
          measureLabel: "Sales",
          agg: "sum",
          groupField: itemField,
          groupRole: "itemName",
          groupMode: "value",
          groupLabel: "Beer",
          filters: [{ field: mapping.menuGroup, values: beerValues }],
          topN: 12,
          order: "desc",
          viz: "bar",
        };
      }
    }
    if (mapping.familyGroup && salesField) {
      specs.family = {
        measureField: salesField,
        measureRole: "netSales",
        measureLabel: "Sales",
        agg: "sum",
        groupField: mapping.familyGroup,
        groupRole: "familyGroup",
        groupMode: "value",
        groupLabel: "Family Group",
        filters: [],
        topN: 12,
        order: "desc",
        viz: "bar",
      };
    }
    return specs;
  }, [mapping, rows]);

  const itemLeaderboard = useMemo(() => {
    if (!starterSpecs.item) return null;
    const result = executeSpec(starterSpecs.item, rows, mapping, globalFilters);
    if (!result || result.kind !== "series") return result;
    const q = itemSearch.trim().toLowerCase();
    if (!q) return result;
    const filtered = result.allData.filter((d) => d.key.toLowerCase().includes(q)).slice(0, 25);
    const total = _.sumBy(filtered, "value") || 0;
    return {
      ...result,
      data: filtered.map((d) => ({ ...d, share: total ? d.value / total : 0 })),
    };
  }, [starterSpecs.item, rows, mapping, globalFilters, itemSearch]);

  function saveView(name, spec, source) {
    setSavedViews((prev) => [...prev, { id: Date.now() + Math.random(), name, spec, source }]);
  }

  function loadView(v) {
    if (v.spec.groupMode === "period" || ["day", "week", "month"].includes(v.spec.groupMode)) {
      setPivot({
        measureRole: v.spec.measureRole || "netSales",
        agg: v.spec.agg,
        groupRole: "menuGroup",
        groupMode: v.spec.groupMode,
        viz: v.spec.viz,
        topN: v.spec.topN || 10,
      });
    } else {
      setPivot({
        measureRole: v.spec.measureRole || "netSales",
        agg: v.spec.agg,
        groupRole: v.spec.groupRole || "menuGroup",
        groupMode: "value",
        viz: v.spec.viz,
        topN: v.spec.topN || 10,
      });
    }
    setTab("explore");
  }

  function exportViews() {
    const blob = new Blob([JSON.stringify({ savedViews, mappingOverride }, null, 2)], {
      type: "application/json",
    });
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

  function exportCSV(result, spec) {
    if (!result || result.kind !== "series") return;
    const header = [spec.groupLabel, spec.measureLabel, "Share", "Lines"];
    const lines = [header.join(",")].concat(
      result.data.map((d) => [JSON.stringify(d.key), d.value, (d.share * 100).toFixed(2) + "%", d.count].join(","))
    );
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), "export.csv");
  }

  function exportCleanedData() {
    if (!rawRows.length) return;
    const cols = Object.keys(rawRows[0]).filter((h) => !h.startsWith("__"));
    const lines = [cols.join(",")].concat(
      rawRows.map((r) =>
        cols
          .map((c) => {
            const v = r[c];
            if (v == null) return "";
            if (v instanceof Date) return v.toISOString();
            const s = String(v);
            return /[",\n]/.test(s) ? JSON.stringify(s) : s;
          })
          .join(",")
      )
    );
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), "tdim_cleaned.csv");
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const ctx = { mapping, rows: filteredRows, dimValues, globalFilters: [] };
    const res = interpretQuery(text, ctx);
    setChat((prev) => [...prev, { role: "user", text }, { role: "assistant", ...res }]);
    setChatInput("");
  }

  const hasData = rows.length > 0;
  const measureRoles = Object.keys(MEASURE_LABELS).filter((r) => mapping[r]);
  const dimRoles = ["daypart", "menuGroup", "familyGroup", "itemName"].filter((r) => mapping[r]);
  const filterRoles = ["daypart", "menuGroup", "familyGroup"].filter((r) => mapping[r]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <div className="flex items-center justify-between bg-slate-900 px-5 py-3 text-white">
        <div>
          <div className="text-base font-bold">F&amp;B Transaction Explorer</div>
          <div className="text-xs text-slate-400">POS analytics · Courtyard Marriott · BI module (v2)</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={handleFiles}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current && fileRef.current.click()}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium hover:bg-teal-600"
          >
            Upload data
          </button>
          {!hasData && (
            <button
              onClick={loadSample}
              className="rounded-md bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
            >
              Load sample data
            </button>
          )}
          {hasData && (
            <button
              onClick={exportCleanedData}
              className="rounded-md bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
              title="Download cleaned rows as CSV"
            >
              Export cleaned
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="flex">
        <aside className="min-h-screen w-64 shrink-0 space-y-4 border-r border-slate-200 bg-white p-3">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Data sources</div>
            {datasets.length === 0 ? (
              <div className="text-xs text-slate-400">None loaded.</div>
            ) : (
              <div className="space-y-1">
                {datasets.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-sm">
                    <span className="truncate text-slate-700">{d.name}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">{d.rows.length}</span>
                      <button
                        onClick={() => removeDataset(d.id)}
                        className="text-xs text-slate-400 hover:text-rose-500"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {hasData && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase text-slate-500">Field mapping</div>
                <button
                  onClick={() => setShowSchema((s) => !s)}
                  className="text-xs text-teal-700 hover:underline"
                >
                  {showSchema ? "Hide schema" : "Schema"}
                </button>
              </div>
              <div className="space-y-1.5">
                {[
                  "date",
                  "checkId",
                  "daypart",
                  "menuGroup",
                  "familyGroup",
                  "itemName",
                  "itemNumber",
                  "refInfo",
                  "netSales",
                  "quantity",
                  "cost",
                ].map((role) => (
                  <div key={role} className="text-xs">
                    <div className="text-slate-500">{ROLE_LABELS[role] || role}</div>
                    <select
                      value={mapping[role] || ""}
                      onChange={(e) => setMappingOverride((m) => ({ ...m, [role]: e.target.value }))}
                      className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-slate-700"
                    >
                      <option value="">— none —</option>
                      {autoSchema.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {mapping.cost && isColumnAllZero(rows, mapping.cost) ? (
                <div className="mt-2 text-xs text-amber-600">Cost column is all zeros. Margin needs Reeco costs.</div>
              ) : null}
              {!mapping.quantity ? (
                <div className="mt-2 text-xs text-slate-500">
                  No quantity column in this export. Item ranks use sales (or line count).
                </div>
              ) : null}
              {showSchema && (
                <div className="mt-3 max-h-56 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  {autoSchema.columns.map((c) => (
                    <div key={c.name} className="border-b border-slate-100 py-1">
                      <div className="font-medium text-slate-700">{c.name}</div>
                      <div className="text-slate-400">
                        {c.type} · {c.role || "unmapped"} · {c.cardinality} values
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase text-slate-500">Saved views</div>
              <div className="flex gap-1">
                <button onClick={exportViews} title="Export" className="text-xs text-slate-400 hover:text-slate-600">
                  ⤓
                </button>
                <input ref={viewsRef} type="file" accept=".json" onChange={importViews} className="hidden" />
                <button
                  onClick={() => viewsRef.current && viewsRef.current.click()}
                  title="Import"
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  ⤒
                </button>
              </div>
            </div>
            {savedViews.length === 0 ? (
              <div className="text-xs text-slate-400">Save a chart or chat answer to pin it here.</div>
            ) : (
              <div className="space-y-1">
                {savedViews.map((v) => (
                  <div key={v.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-sm">
                    <button
                      onClick={() => loadView(v)}
                      className="truncate text-left text-teal-700 hover:underline"
                    >
                      {v.name}
                    </button>
                    <button
                      onClick={() => setSavedViews((p) => p.filter((x) => x.id !== v.id))}
                      className="text-xs text-slate-400 hover:text-rose-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 space-y-4 p-4">
          <div className="flex gap-1 border-b border-slate-200">
            {[
              ["dashboard", "Dashboard"],
              ["explore", "Explore"],
              ["chat", "Assistant"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cx(
                  "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
                  tab === id
                    ? "border-teal-700 text-teal-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {!hasData ? (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
              <div className="text-lg font-semibold text-slate-700">No data loaded</div>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Upload a POS export (TDIM_26Q2.xlsx) or a CSV. The tool auto-detects dates, dimensions, and
                measures, resolves IPA 1 / TYPE IN beer lines, and maps common F&amp;B fields. Correct the
                mapping on the left if needed.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={() => fileRef.current && fileRef.current.click()}
                  className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
                >
                  Upload data
                </button>
                <button
                  onClick={loadSample}
                  className="rounded-md bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
                >
                  Load sample data
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold uppercase text-slate-500">Filters</span>
                {filterRoles.map((role) => (
                  <div key={role} className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-slate-400">{dimLabel(role)}:</span>
                    {_.uniq(rows.map((r) => String(r[mapping[role]])).filter((v) => v && v !== "null"))
                      .slice(0, role === "familyGroup" ? 6 : 8)
                      .map((v) => (
                        <Pill
                          key={v}
                          active={isFilterActive(mapping[role], v)}
                          onClick={() => toggleFilter(mapping[role], v)}
                        >
                          {v}
                        </Pill>
                      ))}
                  </div>
                ))}
                {datasets.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-slate-400">period:</span>
                    {datasets.map((d) => (
                      <Pill
                        key={d.id}
                        active={isFilterActive("__period", d.name)}
                        onClick={() => toggleFilter("__period", d.name)}
                      >
                        {d.name}
                      </Pill>
                    ))}
                  </div>
                )}
                <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={hideModifiers}
                    onChange={(e) => setHideModifiers(e.target.checked)}
                  />
                  Hide leftover TYPE IN lines
                </label>
                {globalFilters.length > 0 && (
                  <button onClick={() => setGlobalFilters([])} className="text-xs text-rose-500 hover:underline">
                    Clear
                  </button>
                )}
              </div>

              {(cleaningSummary.resolved > 0 ||
                cleaningSummary.flagged.length > 0 ||
                cleaningSummary.unpaired > 0) && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-emerald-800">
                      Cleaning applied: <b>{cleaningSummary.resolved}</b> IPA 1 line(s) renamed to the specific
                      beer, <b>{cleaningSummary.deleted}</b> TYPE IN row(s) removed.
                      {cleaningSummary.unpaired ? (
                        <span className="text-emerald-700">
                          {" "}
                          {cleaningSummary.unpaired} IPA 1 line(s) had no type-in and kept their name.
                        </span>
                      ) : null}
                    </div>
                    {cleaningSummary.flagged.length > 0 && (
                      <button
                        onClick={() => setShowFlagged((s) => !s)}
                        className="whitespace-nowrap text-xs text-amber-700 hover:underline"
                      >
                        {cleaningSummary.flagged.length} flagged, {showFlagged ? "hide" : "review"}
                      </button>
                    )}
                  </div>
                  {showFlagged && cleaningSummary.flagged.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-auto rounded border border-amber-200 bg-white p-2">
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

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
                <KpiCard label="Sales" value={fmtCurrency(kpis.net)} />
                <KpiCard label="Checks" value={fmtNumber(kpis.checks)} />
                <KpiCard label="Avg $/check" value={fmtCurrency(kpis.avgCheck, true)} />
                <KpiCard label="Lines" value={fmtNumber(kpis.lines)} />
                <KpiCard label="Distinct items" value={fmtNumber(kpis.distinct)} />
                {mapping.quantity ? (
                  <KpiCard label="Units" value={fmtNumber(kpis.qty)} />
                ) : (
                  <KpiCard label="Avg $/line" value={fmtCurrency(kpis.avgLine, true)} />
                )}
                <KpiCard label="Date span" value={<span className="text-xs">{kpis.span}</span>} />
              </div>

              {tab === "dashboard" && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {starterSpecs.daypart && (
                    <StarterView
                      title="Daypart trends"
                      spec={starterSpecs.daypart}
                      rows={rows}
                      mapping={mapping}
                      globalFilters={globalFilters}
                      onSave={saveView}
                      onCSV={exportCSV}
                    />
                  )}
                  {starterSpecs.menuGroup && (
                    <StarterView
                      title="Menu-group performance"
                      spec={starterSpecs.menuGroup}
                      rows={rows}
                      mapping={mapping}
                      globalFilters={globalFilters}
                      onSave={saveView}
                      onCSV={exportCSV}
                    />
                  )}
                  {starterSpecs.trend && (
                    <div className="lg:col-span-2">
                      <StarterView
                        title="Sales by day"
                        spec={starterSpecs.trend}
                        rows={rows}
                        mapping={mapping}
                        globalFilters={globalFilters}
                        onSave={saveView}
                        onCSV={exportCSV}
                      />
                    </div>
                  )}
                  {starterSpecs.beer && (
                    <StarterView
                      title="Beer mix (post IPA 1 resolve)"
                      spec={starterSpecs.beer}
                      rows={rows}
                      mapping={mapping}
                      globalFilters={globalFilters}
                      onSave={saveView}
                      onCSV={exportCSV}
                    />
                  )}
                  {starterSpecs.family && (
                    <StarterView
                      title="Family-group performance"
                      spec={starterSpecs.family}
                      rows={rows}
                      mapping={mapping}
                      globalFilters={globalFilters}
                      onSave={saveView}
                      onCSV={exportCSV}
                    />
                  )}
                  {starterSpecs.item && itemLeaderboard && (
                    <div className="lg:col-span-2">
                      <Panel
                        title="Item leaderboard"
                        right={
                          <div className="flex items-center gap-2">
                            <input
                              value={itemSearch}
                              onChange={(e) => setItemSearch(e.target.value)}
                              placeholder="Search items…"
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                            <button
                              onClick={() => exportCSV(itemLeaderboard, starterSpecs.item)}
                              className="text-xs text-slate-500 hover:text-slate-700"
                            >
                              CSV
                            </button>
                            <button
                              onClick={() => saveView("Item leaderboard", starterSpecs.item, "starter")}
                              className="text-xs text-teal-700 hover:underline"
                            >
                              Save
                            </button>
                          </div>
                        }
                      >
                        <Chart result={itemLeaderboard} spec={starterSpecs.item} />
                        <ResultTable result={itemLeaderboard} spec={starterSpecs.item} />
                      </Panel>
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
                        <button
                          onClick={() => exportCSV(pivotResult, pivotSpec)}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          Export CSV
                        </button>
                        <button
                          onClick={() =>
                            saveView(pivotSpec.measureLabel + " by " + pivotSpec.groupLabel, pivotSpec, "pivot")
                          }
                          className="text-xs text-teal-700 hover:underline"
                        >
                          Save view
                        </button>
                      </div>
                    ) : null
                  }
                >
                  <div className="mb-4 flex flex-wrap gap-3">
                    <LabeledSelect
                      label="Measure"
                      value={pivot.measureRole}
                      onChange={(v) => setPivot((p) => ({ ...p, measureRole: v }))}
                      options={measureRoles.map((r) => [r, MEASURE_LABELS[r]])}
                    />
                    <LabeledSelect
                      label="Aggregate"
                      value={pivot.agg}
                      onChange={(v) => setPivot((p) => ({ ...p, agg: v }))}
                      options={[
                        ["sum", "Sum"],
                        ["avg", "Average"],
                        ["count", "Line count"],
                        ["distinct", "Distinct"],
                      ]}
                    />
                    <LabeledSelect
                      label="Group by"
                      value={pivot.groupMode === "value" ? pivot.groupRole : pivot.groupMode}
                      onChange={(v) => {
                        if (["day", "week", "month", "period"].includes(v)) {
                          setPivot((p) => ({ ...p, groupMode: v }));
                        } else {
                          setPivot((p) => ({ ...p, groupMode: "value", groupRole: v }));
                        }
                      }}
                      options={[
                        ...dimRoles.map((r) => [r, dimLabel(r)]),
                        ...(mapping.date
                          ? [
                              ["day", "Day"],
                              ["week", "Week"],
                              ["month", "Month"],
                            ]
                          : []),
                        ...(datasets.length > 1 ? [["period", "Period"]] : []),
                      ]}
                    />
                    <LabeledSelect
                      label="Chart"
                      value={pivot.viz}
                      onChange={(v) => setPivot((p) => ({ ...p, viz: v }))}
                      options={[
                        ["bar", "Bar"],
                        ["line", "Line"],
                        ["pie", "Pie"],
                      ]}
                    />
                    <LabeledSelect
                      label="Top N"
                      value={String(pivot.topN)}
                      onChange={(v) => setPivot((p) => ({ ...p, topN: +v }))}
                      options={[
                        ["5", "5"],
                        ["10", "10"],
                        ["15", "15"],
                        ["25", "25"],
                        ["1000", "All"],
                      ]}
                    />
                  </div>
                  <Chart result={pivotResult} spec={pivotSpec} />
                  <ResultTable result={pivotResult} spec={pivotSpec} />
                </Panel>
              )}

              {tab === "chat" && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div
                    className="flex flex-col rounded-lg border border-slate-200 bg-white lg:col-span-2"
                    style={{ height: 560 }}
                  >
                    <div className="flex-1 space-y-3 overflow-auto p-4">
                      {chat.map((m, i) => (
                        <ChatBubble key={i} m={m} onSave={saveView} onCSV={exportCSV} />
                      ))}
                    </div>
                    <div className="flex gap-2 border-t border-slate-100 p-3">
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendChat()}
                        placeholder='Ask: net sales by menu group, top 10 items by sales, lunch revenue by day...'
                        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        onClick={sendChat}
                        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
                      >
                        Ask
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Try</div>
                    <div className="space-y-1.5">
                      {[
                        "net sales by menu group",
                        "top 10 items by sales",
                        "revenue by daypart",
                        "net sales by day",
                        "lunch sales by menu group",
                        "beer sales by item",
                        "what's my margin?",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => setChatInput(s)}
                          className="block w-full rounded px-2 py-1 text-left text-sm text-teal-700 hover:bg-slate-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 text-xs text-slate-400">
                      Deterministic engine in v2. Reports what the data supports and flags what it can&apos;t.
                      Swap for a live model when this moves to a backend (see HANDOFF.md Seam 1).
                    </div>
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
