/**
 * Browser persistence for TDIM.bi workspace.
 * IndexedDB holds monthly datasets + mapping + saved views across reloads.
 * Supabase (HANDOFF Seam 2) can replace this later for multi-device sync.
 */

const DB_NAME = "tdim-bi";
const DB_VERSION = 1;
const STORE = "workspace";
const WORKSPACE_KEY = "default";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });
}

function serializeValue(v) {
  if (v instanceof Date) return { __tdimDate: v.toISOString() };
  return v;
}

function reviveValue(v) {
  if (v && typeof v === "object" && typeof v.__tdimDate === "string") {
    const d = new Date(v.__tdimDate);
    return isNaN(d.getTime()) ? null : d;
  }
  return v;
}

function serializeRows(rows) {
  return (rows || []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = serializeValue(v);
    return out;
  });
}

function reviveRows(rows) {
  return (rows || []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = reviveValue(v);
    return out;
  });
}

function serializeDatasets(datasets) {
  return (datasets || []).map((ds) => ({
    id: ds.id,
    name: ds.name,
    rows: serializeRows(ds.rows),
    summary: ds.summary || null,
    importMeta: ds.importMeta || null,
  }));
}

function reviveDatasets(datasets) {
  return (datasets || []).map((ds) => ({
    ...ds,
    rows: reviveRows(ds.rows),
  }));
}

export async function loadWorkspace() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(WORKSPACE_KEY);
      req.onsuccess = () => {
        const raw = req.result;
        if (!raw) {
          resolve(null);
          return;
        }
        resolve({
          datasets: reviveDatasets(raw.datasets),
          mappingOverride: raw.mappingOverride || {},
          savedViews: raw.savedViews || [],
          hideModifiers: raw.hideModifiers !== false,
          updatedAt: raw.updatedAt || null,
        });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveWorkspace(payload) {
  const record = {
    datasets: serializeDatasets(payload.datasets),
    mappingOverride: payload.mappingOverride || {},
    savedViews: payload.savedViews || [],
    hideModifiers: payload.hideModifiers !== false,
    updatedAt: new Date().toISOString(),
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record, WORKSPACE_KEY);
    tx.oncomplete = () => resolve(record.updatedAt);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearWorkspace() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(WORKSPACE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
