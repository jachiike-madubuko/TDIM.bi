import { useEffect, useMemo, useRef, useState } from "react";
import _ from "lodash";
import {
  Chart,
  ChatBubble,
  KpiCard,
  LabeledSelect,
  Panel,
  ResultTable,
  StarterView,
} from "./ui";
import FilterBar from "./FilterBar";
import StoryConstructor from "./story/StoryConstructor";
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
import { clearWorkspace, loadWorkspace, saveWorkspaceSettings, syncDatasets } from "../lib/supabasePersist";
import { supabaseConfigured } from "../lib/supabase";
import { executeSpec, rowMatchesFilters } from "../lib/query";
import { makeSampleData } from "../lib/sampleData";
import { buildSchema } from "../lib/schema";
import {
  TDIM_REQUIRED_ROLES,
  fixedTdimMapping,
  parseTdimCsv,
  parseTdimWorkbook,
} from "../lib/tdimFormat";

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
  const [tab, setTab] = useState("story");
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
  const [showMapping, setShowMapping] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [importNote, setImportNote] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [persistNote, setPersistNote] = useState("");
  const skipDatasetSyncRef = useRef(true);

  const fileRef = useRef(null);
  const viewsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ws = await loadWorkspace();
        if (cancelled) return;
        if (ws) {
          if (ws.datasets?.length) setDatasets(ws.datasets);
          if (ws.mappingOverride) setMappingOverride(ws.mappingOverride);
          if (ws.savedViews) setSavedViews(ws.savedViews);
          if (typeof ws.hideModifiers === "boolean") setHideModifiers(ws.hideModifiers);
          if (ws.datasets?.length || ws.backend) {
            const where =
              ws.backend === "supabase"
                ? "Supabase"
                : ws.backend === "indexeddb-fallback"
                  ? "IndexedDB (Supabase offline)"
                  : "this browser";
            setPersistNote(
              `Restored ${ws.datasets?.length || 0} period(s) from ${where}` +
                (ws.updatedAt ? ` · saved ${new Date(ws.updatedAt).toLocaleString()}` : "") +
                (supabaseConfigured ? "" : " · set VITE_SUPABASE_* to enable cloud sync")
            );
          }
        } else if (!supabaseConfigured) {
          setPersistNote("Cloud sync off. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable Supabase.");
        }
      } catch (err) {
        if (!cancelled) setError("Could not restore saved data: " + err.message);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      saveWorkspaceSettings({
        datasets,
        mappingOverride,
        savedViews,
        hideModifiers,
      }).catch((err) => {
        setError("Could not save settings: " + err.message);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [mappingOverride, savedViews, hideModifiers, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated) return;
    if (skipDatasetSyncRef.current) {
      skipDatasetSyncRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      Promise.all([
        saveWorkspaceSettings({
          datasets,
          mappingOverride,
          savedViews,
          hideModifiers,
        }),
        syncDatasets(datasets),
      ])
        .then(([settingsRes, syncRes]) => {
          if (syncRes?.backend === "supabase") {
            setPersistNote(`Synced ${datasets.length} period(s) to Supabase`);
          } else if (settingsRes?.backend === "indexeddb") {
            setPersistNote(`Saved ${datasets.length} period(s) in this browser`);
          }
        })
        .catch((err) => {
          setError("Could not sync periods: " + err.message);
        });
    }, 900);
    return () => clearTimeout(t);
  }, [datasets, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const rawRows = useMemo(() => {
    const out = [];
    for (const ds of datasets) for (const r of ds.rows) out.push({ ...r, __period: ds.name });
    return out;
  }, [datasets]);

  const autoSchema = useMemo(() => buildSchema(rawRows), [rawRows]);
  const fixedMap = useMemo(() => {
    if (!rawRows.length) return { mapping: {}, missing: TDIM_REQUIRED_ROLES };
    return fixedTdimMapping(Object.keys(rawRows[0]).filter((h) => !h.startsWith("__")));
  }, [rawRows]);
  const mapping = useMemo(
    () => ({ ...autoSchema.mapping, ...fixedMap.mapping, ...mappingOverride }),
    [autoSchema, fixedMap, mappingOverride]
  );
  const missingRoles = useMemo(
    () => TDIM_REQUIRED_ROLES.filter((r) => !mapping[r]),
    [mapping]
  );
  const mappingNeedsAttention = missingRoles.length > 0;

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

  function openStoryInExplore() {
    setPivot({
      measureRole: "netSales",
      agg: "sum",
      groupRole: "date",
      groupMode: "month",
      viz: "line",
      topN: 36,
    });
    setTab("explore");
  }

  function ingestRows(name, raw, summary, extras) {
    if (!raw || !raw.length) throw new Error("No rows found in " + name);
    setDatasets((prev) => {
      const base = (extras && extras.period) || name.replace(/\.(xlsx|xls|csv)$/i, "");
      let label = base;
      let n = 2;
      const taken = new Set(prev.map((d) => d.name));
      while (taken.has(label)) label = base + " (" + n++ + ")";
      return [
        ...prev,
        {
          id: Date.now() + Math.random(),
          name: label,
          rows: raw,
          summary: summary || null,
          importMeta: extras || null,
        },
      ];
    });
  }

  function handleFiles(e) {
    setError("");
    setImportNote("");
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          let parsed;
          if (/\.csv$/i.test(file.name)) {
            parsed = parseTdimCsv(ev.target.result, file.name);
          } else {
            parsed = parseTdimWorkbook(ev.target.result, file.name);
          }
          const cleaned = cleanTransactions(parsed.rows, {});
          if (parsed.mapping && Object.keys(parsed.mapping).length) {
            setMappingOverride((m) => ({ ...parsed.mapping, ...m }));
          }
          if (parsed.missing && parsed.missing.length) {
            setShowMapping(true);
            setError(
              `Imported ${file.name}, but missing fields: ${parsed.missing.join(", ")}. Map them in the left rail.`
            );
          } else {
            setImportNote(
              `Loaded ${parsed.period}: header Excel row ${parsed.headerExcelRow}, data from row ${parsed.dataStartExcelRow}, ${cleaned.rows.length} lines after IPA cleaning.`
            );
          }
          ingestRows(file.name, cleaned.rows, cleaned.summary, {
            period: parsed.period,
            meta: parsed.meta,
            headerExcelRow: parsed.headerExcelRow,
            dataStartExcelRow: parsed.dataStartExcelRow,
            sourceFilename: file.name,
          });
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
    setImportNote("");
    const cleaned = cleanTransactions(makeSampleData(), {});
    const { mapping: sampleMap } = fixedTdimMapping(Object.keys(cleaned.rows[0] || {}));
    setMappingOverride((m) => ({ ...sampleMap, ...m }));
    ingestRows("Sample Feb 2025–Jun 2026", cleaned.rows, cleaned.summary, {
      period: "Sample Feb 2025–Jun 2026",
    });
  }

  function removeDataset(id) {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
  }

  async function clearAllData() {
    setDatasets([]);
    setMappingOverride({});
    setSavedViews([]);
    setGlobalFilters([]);
    setImportNote("");
    setPersistNote("");
    try {
      await clearWorkspace();
      setPersistNote("Cleared saved workspace from this browser.");
    } catch (err) {
      setError("Could not clear saved data: " + err.message);
    }
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
    <div className="app-shell">
      <div className="app-content">
        <header className="relative z-10 mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="brand-mark">TB</div>
            <div>
              <div className="brand-title text-xl text-white">TDIM.bi</div>
              <div className="text-[11px] font-medium tracking-[0.08em] text-white/40">
                COURTYARD · POS INTELLIGENCE
              </div>
            </div>
          </div>

          <div className="glass hidden items-center gap-1 rounded-full p-1 md:flex">
            {[
              ["story", "Story"],
              ["dashboard", "Overview"],
              ["explore", "Explore"],
              ["chat", "Ask"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cx(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
                  tab === id ? "bg-white text-[#0b0d16]" : "text-white/55 hover:text-white"
                )}
              >
                {label}
              </button>
            ))}
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
            <button onClick={() => fileRef.current && fileRef.current.click()} className="btn btn-primary">
              Upload month
            </button>
            {!hasData && (
              <button onClick={loadSample} className="btn">
                Sample
              </button>
            )}
            {hasData && (
              <button onClick={exportCleanedData} className="btn" title="Download cleaned rows as CSV">
                Export
              </button>
            )}
          </div>
        </header>

        {error ? (
          <div className="mx-auto mt-3 max-w-[1600px] px-4 md:px-6">
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/15 px-4 py-2.5 text-sm text-rose-100">
              {error}
            </div>
          </div>
        ) : null}
        {persistNote && !error ? (
          <div className="mx-auto mt-3 max-w-[1600px] px-4 md:px-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/60">
              {persistNote}
            </div>
          </div>
        ) : null}
        {importNote && !error ? (
          <div className="mx-auto mt-3 max-w-[1600px] px-4 md:px-6">
            <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-100">
              {importNote}
            </div>
          </div>
        ) : null}

        <div className="app-grid relative z-10 mx-auto grid max-w-[1600px] grid-cols-[260px_1fr] gap-4 px-4 py-4 md:px-6">
          <aside className="rail glass sticky top-4 h-fit space-y-5 rounded-[1.5rem] p-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Periods
                </div>
                {datasets.length > 0 && (
                  <button
                    onClick={clearAllData}
                    className="text-[11px] font-semibold text-rose-300/80 hover:text-rose-200"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {datasets.length === 0 ? (
                <div className="text-xs text-white/35">
                  Upload monthly TDIM files to stack 2025 → now. They stay in this browser until you clear them.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {datasets.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-2.5 py-2 text-sm"
                    >
                      <span className="truncate font-medium text-white/85">{d.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-white/35">{d.rows.length}</span>
                        <button
                          onClick={() => removeDataset(d.id)}
                          className="text-white/30 transition hover:text-rose-300"
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
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                    Mapping
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowSchema((s) => !s)}
                      className="text-[11px] font-semibold text-[#a5b4fc] hover:text-white"
                    >
                      {showSchema ? "Hide" : "Schema"}
                    </button>
                    {(mappingNeedsAttention || showMapping) && (
                      <button
                        onClick={() => setShowMapping((s) => !s)}
                        className="text-[11px] font-semibold text-[#a5b4fc] hover:text-white"
                      >
                        {showMapping ? "Done" : "Edit"}
                      </button>
                    )}
                  </div>
                </div>

                {mappingNeedsAttention ? (
                  <div className="mb-2 rounded-xl border border-amber-300/25 bg-amber-400/10 p-2 text-xs text-amber-100">
                    Missing: {missingRoles.join(", ")}
                  </div>
                ) : (
                  <div className="mb-2 text-xs text-white/40">
                    Auto-mapped to TDIM columns.
                    {!showMapping && (
                      <button
                        onClick={() => setShowMapping(true)}
                        className="ml-1 font-semibold text-[#a5b4fc] hover:text-white"
                      >
                        Override
                      </button>
                    )}
                  </div>
                )}

                {(showMapping || mappingNeedsAttention) && (
                  <div className="space-y-2">
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
                        <div
                          className={cx(
                            "mb-1 text-white/40",
                            missingRoles.includes(role) && "font-semibold text-amber-200"
                          )}
                        >
                          {ROLE_LABELS[role] || role}
                          {missingRoles.includes(role) ? " *" : ""}
                        </div>
                        <select
                          value={mapping[role] || ""}
                          onChange={(e) => setMappingOverride((m) => ({ ...m, [role]: e.target.value }))}
                          className="select"
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
                )}

                {mapping.cost && isColumnAllZero(rows, mapping.cost) ? (
                  <div className="mt-2 text-xs text-amber-200/80">COGS is zero. Margin needs Reeco.</div>
                ) : null}
                {!mapping.quantity ? (
                  <div className="mt-2 text-xs text-white/35">No qty column. Ranks use sales.</div>
                ) : null}
                {showSchema && (
                  <div className="scroll-thin mt-3 max-h-56 overflow-auto rounded-xl border border-white/8 bg-black/20 p-2 text-xs">
                    {autoSchema.columns.map((c) => (
                      <div key={c.name} className="border-b border-white/5 py-1.5">
                        <div className="font-medium text-white/80">{c.name}</div>
                        <div className="text-white/35">
                          {c.type} · {c.role || "unmapped"} · {c.cardinality}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Saved views
                </div>
                <div className="flex gap-2">
                  <button onClick={exportViews} title="Export" className="text-white/35 hover:text-white">
                    ⤓
                  </button>
                  <input ref={viewsRef} type="file" accept=".json" onChange={importViews} className="hidden" />
                  <button
                    onClick={() => viewsRef.current && viewsRef.current.click()}
                    title="Import"
                    className="text-white/35 hover:text-white"
                  >
                    ⤒
                  </button>
                </div>
              </div>
              {savedViews.length === 0 ? (
                <div className="text-xs text-white/35">Pin charts or answers here.</div>
              ) : (
                <div className="space-y-1.5">
                  {savedViews.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-2.5 py-2 text-sm"
                    >
                      <button
                        onClick={() => loadView(v)}
                        className="truncate text-left font-medium text-[#c4b5fd] hover:text-white"
                      >
                        {v.name}
                      </button>
                      <button
                        onClick={() => setSavedViews((p) => p.filter((x) => x.id !== v.id))}
                        className="text-white/30 hover:text-rose-300"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            {!hasData && tab === "story" ? (
              <StoryConstructor
                rows={filteredRows}
                mapping={mapping}
                onOpenExplore={openStoryInExplore}
                onRequestLoad={() => fileRef.current?.click()}
                onLoadSample={loadSample}
              />
            ) : !hasData ? (
              <div className="glass rise relative overflow-hidden rounded-[1.75rem] px-8 py-16 text-center">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(124,140,255,0.25),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(217,70,239,0.18),transparent_40%)]" />
                <div className="relative">
                  <div className="brand-title text-4xl text-white md:text-5xl">TDIM.bi</div>
                  <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-white/55">
                    Drop monthly Symphony / TD exports. We skip the preamble, auto-map columns, resolve IPA 1
                    type-ins, and open on the Story Constructor (Setup → Conflict → Resolution).
                  </p>
                  <div className="mt-7 flex items-center justify-center gap-3">
                    <button
                      onClick={() => fileRef.current && fileRef.current.click()}
                      className="btn btn-primary px-5 py-2.5"
                    >
                      Load TD files
                    </button>
                    <button onClick={loadSample} className="btn px-5 py-2.5">
                      Preview sample
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <FilterBar
                  rows={rows}
                  mapping={mapping}
                  datasets={datasets}
                  filterRoles={filterRoles}
                  globalFilters={globalFilters}
                  hideModifiers={hideModifiers}
                  onToggleFilter={toggleFilter}
                  onClearFilters={() => setGlobalFilters([])}
                  onHideModifiers={setHideModifiers}
                  isFilterActive={isFilterActive}
                />

                {(cleaningSummary.resolved > 0 ||
                  cleaningSummary.flagged.length > 0 ||
                  cleaningSummary.unpaired > 0) && (
                  <div className="glass rise rounded-[1.25rem] border-emerald-400/20 p-3.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-emerald-100/90">
                        Cleaning: <b>{cleaningSummary.resolved}</b> IPA 1 renamed,{" "}
                        <b>{cleaningSummary.deleted}</b> TYPE IN removed.
                        {cleaningSummary.unpaired ? (
                          <span className="text-emerald-100/60">
                            {" "}
                            {cleaningSummary.unpaired} unpaired kept as IPA 1.
                          </span>
                        ) : null}
                      </div>
                      {cleaningSummary.flagged.length > 0 && (
                        <button
                          onClick={() => setShowFlagged((s) => !s)}
                          className="whitespace-nowrap text-xs font-semibold text-amber-200 hover:text-white"
                        >
                          {cleaningSummary.flagged.length} flagged · {showFlagged ? "hide" : "review"}
                        </button>
                      )}
                    </div>
                    {showFlagged && cleaningSummary.flagged.length > 0 && (
                      <div className="scroll-thin mt-3 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/25 p-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-white/40">
                              <th className="pr-3 font-medium">Check</th>
                              <th className="pr-3 font-medium">Renamed to</th>
                              <th className="font-medium">Why</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cleaningSummary.flagged.map((f, i) => (
                              <tr key={i} className="border-t border-white/5">
                                <td className="pr-3 text-white/55">{f.check}</td>
                                <td className="pr-3 text-white/90">{f.name}</td>
                                <td className="text-amber-200/80">{f.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
                  <KpiCard label="Sales" value={fmtCurrency(kpis.net)} accent="rgba(124,140,255,0.7)" />
                  <KpiCard label="Checks" value={fmtNumber(kpis.checks)} accent="rgba(34,211,238,0.55)" />
                  <KpiCard
                    label="Avg $/check"
                    value={fmtCurrency(kpis.avgCheck, true)}
                    accent="rgba(217,70,239,0.5)"
                  />
                  <KpiCard label="Lines" value={fmtNumber(kpis.lines)} accent="rgba(167,139,250,0.5)" />
                  <KpiCard
                    label="Distinct items"
                    value={fmtNumber(kpis.distinct)}
                    accent="rgba(52,211,153,0.45)"
                  />
                  {mapping.quantity ? (
                    <KpiCard label="Units" value={fmtNumber(kpis.qty)} accent="rgba(251,113,133,0.45)" />
                  ) : (
                    <KpiCard
                      label="Avg $/line"
                      value={fmtCurrency(kpis.avgLine, true)}
                      accent="rgba(251,191,36,0.4)"
                    />
                  )}
                  <KpiCard
                    label="Date span"
                    value={<span className="text-sm tracking-normal">{kpis.span}</span>}
                    accent="rgba(96,165,250,0.4)"
                  />
                </div>

                {tab === "story" && (
                  <StoryConstructor
                    rows={filteredRows}
                    mapping={mapping}
                    onOpenExplore={openStoryInExplore}
                    onRequestLoad={() => fileRef.current?.click()}
                    onLoadSample={loadSample}
                  />
                )}

                {tab === "dashboard" && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {starterSpecs.daypart && (
                      <StarterView
                        title="Daypart mix"
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
                        title="Menu group performance"
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
                          title="Sales pulse"
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
                        title="Beer mix"
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
                        title="Family groups"
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
                                className="field w-40 text-xs"
                              />
                              <button
                                onClick={() => exportCSV(itemLeaderboard, starterSpecs.item)}
                                className="text-xs font-semibold text-white/40 hover:text-white"
                              >
                                CSV
                              </button>
                              <button
                                onClick={() => saveView("Item leaderboard", starterSpecs.item, "starter")}
                                className="text-xs font-semibold text-[#a5b4fc] hover:text-white"
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
                    title="Pivot studio"
                    right={
                      pivotResult && pivotResult.kind === "series" ? (
                        <div className="flex gap-3">
                          <button
                            onClick={() => exportCSV(pivotResult, pivotSpec)}
                            className="text-xs font-semibold text-white/40 hover:text-white"
                          >
                            Export CSV
                          </button>
                          <button
                            onClick={() =>
                              saveView(
                                pivotSpec.measureLabel + " by " + pivotSpec.groupLabel,
                                pivotSpec,
                                "pivot"
                              )
                            }
                            className="text-xs font-semibold text-[#a5b4fc] hover:text-white"
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
                      className="glass flex flex-col overflow-hidden rounded-[1.5rem] lg:col-span-2"
                      style={{ height: 560 }}
                    >
                      <div className="scroll-thin flex-1 space-y-3 overflow-auto p-4">
                        {chat.map((m, i) => (
                          <ChatBubble key={i} m={m} onSave={saveView} onCSV={exportCSV} />
                        ))}
                      </div>
                      <div className="flex gap-2 border-t border-white/8 p-3">
                        <input
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && sendChat()}
                          placeholder="Ask about sales, daypart, mix…"
                          className="field flex-1"
                        />
                        <button onClick={sendChat} className="btn btn-primary">
                          Ask
                        </button>
                      </div>
                    </div>
                    <div className="glass rounded-[1.5rem] p-4">
                      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                        Try
                      </div>
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
                            className="block w-full rounded-xl px-2.5 py-2 text-left text-sm text-[#c4b5fd] transition hover:bg-white/6 hover:text-white"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 text-xs leading-relaxed text-white/35">
                        Honest about what POS can&apos;t answer. Live model is Seam 1 when you&apos;re ready.
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      <nav className="dock glass-strong" aria-label="Primary">
        {[
          ["story", "Story"],
          ["dashboard", "Overview"],
          ["explore", "Explore"],
          ["chat", "Ask"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cx("dock-btn", tab === id && "active")}
          >
            <span className="dock-dot" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
