import _ from "lodash";
import { bucketDate, coerceNumber, toDate } from "./helpers";

export function rowMatchesFilters(row, filters, mapping) {
  if (!filters || !filters.length) return true;
  for (const f of filters) {
    const field = f.field || mapping[f.role];
    if (!field) continue;
    if (field === "__period") {
      const sval = row.__period == null ? "" : String(row.__period);
      if (f.values && f.values.length && !f.values.map(String).includes(sval)) return false;
      continue;
    }
    const val = row[field];
    const sval = val == null ? "" : String(val);
    if (f.values && f.values.length && !f.values.map(String).includes(sval)) return false;
  }
  return true;
}

export function groupKeyFor(row, spec, mapping) {
  if (spec.groupMode === "period") return row.__period || "All";
  if (["day", "week", "month"].includes(spec.groupMode)) {
    const d = toDate(row[mapping.date]);
    return bucketDate(d, spec.groupMode) || "(no date)";
  }
  const v = row[spec.groupField];
  return v == null || v === "" ? "(blank)" : String(v);
}

export function aggReducer(agg, field) {
  if (agg === "count") return (rows) => rows.length;
  if (agg === "distinct") {
    return (rows) =>
      new Set(rows.map((r) => String(r[field])).filter((x) => x !== "null" && x !== "")).size;
  }
  const nums = (rows) => rows.map((r) => coerceNumber(r[field])).filter((n) => n != null);
  if (agg === "avg") {
    return (rows) => {
      const a = nums(rows);
      return a.length ? _.sum(a) / a.length : 0;
    };
  }
  return (rows) => _.sum(nums(rows));
}

export function executeSpec(spec, allRows, mapping, globalFilters) {
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
