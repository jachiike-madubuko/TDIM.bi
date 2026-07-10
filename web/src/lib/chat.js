import { DIM_SYNONYMS, MEASURE_LABELS, MEASURE_SYNONYMS } from "./constants";
import { fmtCurrency, fmtNumber, fmtPct, isColumnAllZero, isCurrencyRole } from "./helpers";
import { executeSpec } from "./query";

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
  for (const role of ["daypart", "menuGroup", "familyGroup"]) {
    const field = ctx.mapping[role];
    if (!field) continue;
    const values = (ctx.dimValues[field] || []).filter((v) => q.includes(String(v).toLowerCase()));
    if (values.length) filters.push({ field, values });
  }
  return filters;
}

function dimLabel(role) {
  if (role === "menuGroup") return "Menu Group";
  if (role === "daypart") return "Daypart";
  if (role === "itemName") return "Item";
  if (role === "familyGroup") return "Family Group";
  return role;
}

export function interpretQuery(text, ctx) {
  const q = " " + text.toLowerCase().trim() + " ";
  const { mapping, rows } = ctx;

  if (!rows.length) {
    return {
      type: "cantAnswer",
      text: "No data is loaded yet. Upload a POS export (xlsx or csv), or click Load sample data to try the tool.",
    };
  }

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
    return {
      type: "cantAnswer",
      text: "Labor and scheduling aren't in a POS transaction export. That lives in your scheduling/occupancy data. Load that dataset to answer labor questions.",
    };
  }
  if (/(inventory|stock|waste|spoilage|par level|on hand|86'?d|depletion)/.test(q)) {
    return {
      type: "cantAnswer",
      text: "Inventory and waste aren't in transaction data. Pull Reeco purchases and counts for that. Here I can only speak to what sold.",
    };
  }
  if (/(forecast|predict|projection|next quarter|will sell|expected|future)/.test(q)) {
    return {
      type: "cantAnswer",
      text: "I don't forecast — I report what happened. Load multiple quarters and ask for a trend (\"net sales by month\"), and you can extrapolate from the slope. A real forecast needs a model layer on top.",
    };
  }
  if (/(guest|customer).*(age|gender|demograph|loyalty|repeat|satisfaction|nps|review|rating)/.test(q)) {
    return {
      type: "cantAnswer",
      text: "Guest demographics and satisfaction aren't in POS lines. That comes from your CRM/loyalty or survey data.",
    };
  }

  let measureRole = detectMeasure(q, mapping);
  const agg = detectAgg(q);
  if (!measureRole && agg !== "count") {
    if (mapping.netSales) measureRole = "netSales";
    else if (mapping.quantity) measureRole = "quantity";
  }
  const measureField = measureRole ? mapping[measureRole] : null;
  if (!measureField && agg !== "count") {
    return {
      type: "cantAnswer",
      text:
        "I couldn't find a metric to measure in this file. Detected measures: " +
        Object.keys(mapping)
          .filter((r) => MEASURE_LABELS[r])
          .map((r) => MEASURE_LABELS[r])
          .join(", ") +
        '. Try naming one, e.g. "units by daypart."',
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
      groupLabel = dimLabel(dim.role);
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

  const result = executeSpec(spec, rows, mapping, ctx.globalFilters);
  const filterNote = spec.filters.length
    ? " (filtered to " + spec.filters.map((f) => f.values.join("/")).join(", ") + ")"
    : "";

  if (result.kind === "kpi") {
    const val =
      spec.measureRole && isCurrencyRole(spec.measureRole)
        ? fmtCurrency(result.value, true)
        : fmtNumber(result.value);
    return {
      type: "answer",
      text: `${spec.agg === "avg" ? "Average" : "Total"} ${spec.measureLabel}${filterNote}: ${val} across ${fmtNumber(result.rowCount)} lines.`,
      spec,
      result,
    };
  }

  const top = result.data[0];
  const lead = top
    ? `${spec.measureLabel} by ${spec.groupLabel}${filterNote}. Leader: ${top.key} at ${
        spec.measureRole && isCurrencyRole(spec.measureRole) ? fmtCurrency(top.value) : fmtNumber(top.value)
      } (${fmtPct(top.share)} of shown).`
    : "No rows matched.";
  return { type: "answer", text: lead, spec, result };
}
