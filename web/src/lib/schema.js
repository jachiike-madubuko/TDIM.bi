import { ROLE_MATCHERS } from "./constants";
import { coerceNumber, excelSerialToDate, normalizeHeader } from "./helpers";
import { TDIM_COLUMN_ROLES } from "./tdimFormat";

export function matchRole(header) {
  const exact = normalizeHeader(header);
  if (!exact) return null;
  if (TDIM_COLUMN_ROLES[exact]) return TDIM_COLUMN_ROLES[exact];
  const h = exact.toLowerCase();
  for (const [colName, role] of Object.entries(TDIM_COLUMN_ROLES)) {
    if (colName.toLowerCase() === h) return role;
  }
  for (const [role, keywords] of ROLE_MATCHERS) {
    for (const kw of keywords) {
      if (h.includes(kw)) return role;
    }
  }
  return null;
}

export function inferType(values) {
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

export function buildSchema(rows) {
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

  const mapping = {};
  for (const col of columns) {
    if (col.role && !mapping[col.role]) mapping[col.role] = col.name;
  }
  if (mapping.date) {
    const dcol = columns.find((c) => c.name === mapping.date);
    if (dcol && dcol.type !== "date" && dcol.type !== "number") delete mapping.date;
  }
  return { columns, mapping };
}
