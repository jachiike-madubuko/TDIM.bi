import { coerceNumber, toDate } from "./helpers";
import {
  clearWorkspace as clearLocalWorkspace,
  loadWorkspace as loadLocalWorkspace,
  saveWorkspace as saveLocalWorkspace,
} from "./persist";
import { DEFAULT_VENUE_SLUG, supabase, supabaseConfigured } from "./supabase";

function serializeRowValue(v) {
  if (v instanceof Date) return { __tdimDate: v.toISOString() };
  return v;
}

function reviveRowValue(v) {
  if (v && typeof v === "object" && typeof v.__tdimDate === "string") {
    const d = new Date(v.__tdimDate);
    return isNaN(d.getTime()) ? null : d;
  }
  return v;
}

export function serializeDatasetRows(rows) {
  return (rows || []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = serializeRowValue(v);
    return out;
  });
}

export function reviveDatasetRows(rows) {
  return (rows || []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = reviveRowValue(v);
    return out;
  });
}

function rowToTxnLine(venueId, periodId, row) {
  const txnAt = toDate(row["Transaction Date and Time"]);
  return {
    venue_id: venueId,
    period_id: periodId,
    txn_at: txnAt ? txnAt.toISOString() : null,
    check_number: row["Check Number"] != null ? String(row["Check Number"]) : null,
    item_name: row["Menu Item Name"] != null ? String(row["Menu Item Name"]) : null,
    item_number: row["Menu Item Number"] != null ? String(row["Menu Item Number"]) : null,
    line_total: coerceNumber(row["Check Line Total"]),
    ref_info:
      row["Reference Information Line 1"] != null ? String(row["Reference Information Line 1"]) : null,
    cogs_amount: coerceNumber(row["Cost of Goods Sold Amount"]),
    daypart: row["Day Part Name"] != null ? String(row["Day Part Name"]) : null,
    quarter_hour: row["Quarter Hour"] != null ? String(row["Quarter Hour"]) : null,
    major_group: row["Major Group Name"] != null ? String(row["Major Group Name"]) : null,
    family_group: row["Family Group Name"] != null ? String(row["Family Group Name"]) : null,
    raw: serializeDatasetRows([row])[0],
  };
}

async function getVenueId() {
  const { data, error } = await supabase
    .from("tdim_venues")
    .select("id")
    .eq("slug", DEFAULT_VENUE_SLUG)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error(`Venue '${DEFAULT_VENUE_SLUG}' not found in Supabase`);
  return data.id;
}

async function chunkInsert(table, rows, size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const { error } = await supabase.from(table).insert(slice);
    if (error) throw error;
  }
}

export async function loadWorkspace() {
  if (!supabaseConfigured) {
    const local = await loadLocalWorkspace();
    if (local) local.backend = "indexeddb";
    return local;
  }

  try {
    const venueId = await getVenueId();
    const [{ data: periods, error: pErr }, { data: workspace, error: wErr }] = await Promise.all([
      supabase
        .from("tdim_periods")
        .select("id, name, source_filename, row_count, cleaning_summary, import_meta, rows_json, updated_at")
        .eq("venue_id", venueId)
        .order("name", { ascending: true }),
      supabase.from("tdim_workspace").select("*").eq("venue_id", venueId).maybeSingle(),
    ]);
    if (pErr) throw pErr;
    if (wErr) throw wErr;

    const datasets = (periods || []).map((p) => ({
      id: p.id,
      name: p.name,
      rows: reviveDatasetRows(p.rows_json || []),
      summary: p.cleaning_summary || null,
      importMeta: {
        ...(p.import_meta || {}),
        sourceFilename: p.source_filename || null,
        backend: "supabase",
      },
    }));

    return {
      datasets,
      mappingOverride: workspace?.mapping_override || {},
      savedViews: workspace?.saved_views || [],
      hideModifiers: workspace?.hide_modifiers !== false,
      updatedAt: workspace?.updated_at || periods?.[0]?.updated_at || null,
      backend: "supabase",
      venueId,
    };
  } catch (err) {
    console.warn("Supabase load failed, falling back to IndexedDB", err);
    const local = await loadLocalWorkspace();
    if (local) local.backend = "indexeddb-fallback";
    return local;
  }
}

export async function saveWorkspaceSettings(payload) {
  await saveLocalWorkspace({
    datasets: payload.datasets || [],
    mappingOverride: payload.mappingOverride || {},
    savedViews: payload.savedViews || [],
    hideModifiers: payload.hideModifiers !== false,
  });

  if (!supabaseConfigured) return { backend: "indexeddb" };

  const venueId = await getVenueId();
  const { error } = await supabase.from("tdim_workspace").upsert(
    {
      venue_id: venueId,
      mapping_override: payload.mappingOverride || {},
      saved_views: payload.savedViews || [],
      hide_modifiers: payload.hideModifiers !== false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "venue_id" }
  );
  if (error) throw error;
  return { backend: "supabase", venueId };
}

export async function syncDatasets(datasets) {
  // Local mirror of full workspace blob is handled by saveWorkspaceSettings callers.
  if (!supabaseConfigured) return { backend: "indexeddb" };

  const venueId = await getVenueId();
  const list = datasets || [];

  const { data: existing, error: exErr } = await supabase
    .from("tdim_periods")
    .select("id, name")
    .eq("venue_id", venueId);
  if (exErr) throw exErr;

  const keepNames = new Set(list.map((d) => d.name));
  const toDelete = (existing || []).filter((p) => !keepNames.has(p.name));
  if (toDelete.length) {
    const { error } = await supabase.from("tdim_periods").delete().in(
      "id",
      toDelete.map((p) => p.id)
    );
    if (error) throw error;
  }

  for (const ds of list) {
    const rowsJson = serializeDatasetRows(ds.rows);
    const upsertPayload = {
      venue_id: venueId,
      name: ds.name,
      source_filename: ds.importMeta?.sourceFilename || null,
      row_count: ds.rows?.length || 0,
      cleaning_summary: ds.summary || null,
      import_meta: ds.importMeta || null,
      rows_json: rowsJson,
      updated_at: new Date().toISOString(),
    };

    const { data: period, error: upErr } = await supabase
      .from("tdim_periods")
      .upsert(upsertPayload, { onConflict: "venue_id,name" })
      .select("id")
      .single();
    if (upErr) throw upErr;

    const { error: delLinesErr } = await supabase.from("tdim_txn_lines").delete().eq("period_id", period.id);
    if (delLinesErr) throw delLinesErr;

    const lines = (ds.rows || []).map((row) => rowToTxnLine(venueId, period.id, row));
    if (lines.length) await chunkInsert("tdim_txn_lines", lines);
  }

  return { backend: "supabase", venueId, periods: list.length };
}

/** Full save helper used by Clear / one-shot flows. */
export async function saveWorkspace(payload) {
  await saveWorkspaceSettings(payload);
  return syncDatasets(payload.datasets || []);
}

export async function clearWorkspace() {
  await clearLocalWorkspace();
  if (!supabaseConfigured) return { backend: "indexeddb" };

  const venueId = await getVenueId();
  const { error } = await supabase.from("tdim_periods").delete().eq("venue_id", venueId);
  if (error) throw error;
  const { error: wsErr } = await supabase
    .from("tdim_workspace")
    .update({
      mapping_override: {},
      saved_views: [],
      hide_modifiers: true,
      updated_at: new Date().toISOString(),
    })
    .eq("venue_id", venueId);
  if (wsErr) throw wsErr;
  return { backend: "supabase", venueId };
}
