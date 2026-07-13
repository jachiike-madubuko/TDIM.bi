import * as XLSX from "xlsx";
import { toDate } from "./helpers";

/**
 * Oracle Symphony / TDIM "Transactional Data for Inv Mgmt" layout.
 * Report preamble occupies rows 1–6. Column headers are on row 7.
 * First data row is row 8 (1-indexed Excel).
 * Flat cleaned exports (header on row 1) are also accepted.
 */

export const TDIM_HEADER_MARKERS = [
  "Transaction Date and Time",
  "Menu Item Name",
  "Check Line Total",
];

/** Exact header -> role. Same format every month. */
export const TDIM_COLUMN_ROLES = {
  "Transaction Date and Time": "date",
  "Check Number": "checkId",
  "Menu Item Name": "itemName",
  "Menu Item Number": "itemNumber",
  "Check Line Total": "netSales",
  "Reference Information Line 1": "refInfo",
  "Cost of Goods Sold Amount": "cost",
  "Day Part Name": "daypart",
  "Quarter Hour": "quarterHour",
  "Major Group Name": "menuGroup",
  "Family Group Name": "familyGroup",
};

/** Roles the explorer needs to be useful. Mapping UI only opens if any are missing. */
export const TDIM_REQUIRED_ROLES = ["date", "checkId", "itemName", "netSales", "daypart", "menuGroup", "refInfo"];

/** Excel 1-indexed: header on row 7, data from row 8. */
export const TDIM_HEADER_ROW_1INDEX = 7;

export function cellText(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

export function isHeaderRow(cells) {
  const texts = cells.map((c) => cellText(c).toLowerCase());
  const joined = texts.join(" | ");
  return (
    texts.includes("transaction date and time") ||
    (texts.includes("menu item name") && texts.includes("check number")) ||
    (joined.includes("check line total") && joined.includes("menu item"))
  );
}

/**
 * Find the header row index in a sheet-as-AOA (0-indexed).
 * Prefers an explicit header match; falls back to Excel row 7.
 */
export function findHeaderRowIndex(aoa) {
  const scan = Math.min(aoa.length, 30);
  for (let i = 0; i < scan; i++) {
    const row = aoa[i] || [];
    if (isHeaderRow(row)) return i;
  }
  // Symphony default: header on row 7 (1-indexed) => index 6
  const fallback = TDIM_HEADER_ROW_1INDEX - 1;
  if (aoa.length > fallback) return fallback;
  return 0;
}

export function extractPreambleMeta(aoa, headerIndex) {
  const meta = {};
  for (let i = 0; i < headerIndex; i++) {
    const row = aoa[i] || [];
    const key = cellText(row[0]).toLowerCase();
    const val = cellText(row[1]);
    if (!key || !val) continue;
    if (key.includes("business date")) meta.businessDates = val;
    else if (key.includes("location")) meta.location = val;
    else if (key.includes("revenue center")) meta.revenueCenters = val;
    else if (key.includes("order type")) meta.orderTypes = val;
  }
  return meta;
}

export function rowsFromAoa(aoa, headerIndex) {
  const headerRow = aoa[headerIndex] || [];
  const headers = headerRow.map((h, i) => {
    const t = cellText(h);
    return t || `Column ${i + 1}`;
  });
  const rows = [];
  for (let r = headerIndex + 1; r < aoa.length; r++) {
    const line = aoa[r] || [];
    if (!line.some((c) => c != null && cellText(c) !== "")) continue;
    const obj = {};
    let any = false;
    for (let c = 0; c < headers.length; c++) {
      let v = line[c] != null ? line[c] : null;
      if (typeof v === "string" && v.trim() === "") v = null;
      obj[headers[c]] = v;
      if (v != null) any = true;
    }
    if (any) rows.push(obj);
  }
  return { headers, rows };
}

export function fixedTdimMapping(headers) {
  const mapping = {};
  const missing = [];
  const lower = Object.fromEntries(headers.map((h) => [h.toLowerCase(), h]));

  for (const [exact, role] of Object.entries(TDIM_COLUMN_ROLES)) {
    if (headers.includes(exact)) {
      mapping[role] = exact;
    } else if (lower[exact.toLowerCase()]) {
      mapping[role] = lower[exact.toLowerCase()];
    }
  }

  for (const role of TDIM_REQUIRED_ROLES) {
    if (!mapping[role]) missing.push(role);
  }
  return { mapping, missing };
}

export function periodLabelFromMeta(meta, rows, fileName) {
  if (meta && meta.businessDates) {
    // "1/1/2026 - 1/31/2026" or "January 2025"
    const m = String(meta.businessDates).match(
      /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/
    );
    if (m) {
      const y1 = +m[3];
      const mo1 = +m[1];
      const y2 = +m[6];
      const mo2 = +m[4];
      if (y1 === y2 && mo1 === mo2) {
        return `${y1}-${String(mo1).padStart(2, "0")}`;
      }
      return `${y1}-${String(mo1).padStart(2, "0")} → ${y2}-${String(mo2).padStart(2, "0")}`;
    }
    return String(meta.businessDates).trim();
  }

  const base = String(fileName || "")
    .replace(/\.(xlsx|xls|csv)$/i, "")
    .trim();
  const monthFromName = base.match(/(20\d{2})[-_ ]?(0?[1-9]|1[0-2])/);
  if (monthFromName) {
    return `${monthFromName[1]}-${String(+monthFromName[2]).padStart(2, "0")}`;
  }

  const dateCol = "Transaction Date and Time";
  const dates = (rows || []).map((r) => toDate(r[dateCol])).filter(Boolean);
  if (dates.length) {
    let minT = dates[0].getTime();
    let maxT = minT;
    for (const d of dates) {
      const t = d.getTime();
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const minD = new Date(minT);
    const maxD = new Date(maxT);
    const a = `${minD.getUTCFullYear()}-${String(minD.getUTCMonth() + 1).padStart(2, "0")}`;
    const b = `${maxD.getUTCFullYear()}-${String(maxD.getUTCMonth() + 1).padStart(2, "0")}`;
    return a === b ? a : `${a} → ${b}`;
  }

  return base || "TDIM";
}

/**
 * Parse a Symphony TDIM workbook (ArrayBuffer) into rows + fixed mapping.
 */
export function parseTdimWorkbook(arrayBuffer, fileName) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!aoa.length) throw new Error("Workbook is empty");

  const headerIndex = findHeaderRowIndex(aoa);
  const meta = extractPreambleMeta(aoa, headerIndex);
  const { headers, rows } = rowsFromAoa(aoa, headerIndex);
  if (!rows.length) {
    throw new Error(
      `No data rows found after header (Excel row ${headerIndex + 1}). Expected data starting on row ${headerIndex + 2}.`
    );
  }

  const { mapping, missing } = fixedTdimMapping(headers);
  const period = periodLabelFromMeta(meta, rows, fileName);

  return {
    rows,
    headers,
    mapping,
    missing,
    meta,
    period,
    headerExcelRow: headerIndex + 1,
    dataStartExcelRow: headerIndex + 2,
  };
}

export function parseTdimCsv(text, fileName) {
  // CSV exports are usually already flat (header on first row).
  const wb = XLSX.read(text, { type: "string", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const headerIndex = findHeaderRowIndex(aoa);
  const meta = extractPreambleMeta(aoa, headerIndex);
  const { headers, rows } = rowsFromAoa(aoa, headerIndex);
  const { mapping, missing } = fixedTdimMapping(headers);
  const period = periodLabelFromMeta(meta, rows, fileName);
  return {
    rows,
    headers,
    mapping,
    missing,
    meta,
    period,
    headerExcelRow: headerIndex + 1,
    dataStartExcelRow: headerIndex + 2,
  };
}
