import _ from "lodash";
import { coerceNumber, fmtCurrency, fmtNumber, fmtPct, toDate } from "./helpers";

export const DEFAULT_INDEX_MONTH = "2025-08";

function monthKey(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function yearOf(d) {
  return d.getUTCFullYear();
}

function monthOf(d) {
  return d.getUTCMonth() + 1;
}

function pctDelta(curr, prev) {
  if (prev == null || prev === 0 || curr == null) return null;
  return (curr - prev) / Math.abs(prev);
}

function sumSales(rows, salesField) {
  return _.sumBy(rows, (r) => coerceNumber(r[salesField]) || 0);
}

function distinctChecks(rows, checkField) {
  if (!checkField) return null;
  return new Set(rows.map((r) => String(r[checkField])).filter((v) => v && v !== "null")).size;
}

function annotateRows(rows, mapping) {
  const dateField = mapping.date;
  const salesField = mapping.netSales;
  if (!dateField || !salesField) return [];
  const out = [];
  for (const r of rows) {
    const d = toDate(r[dateField]);
    if (!d) continue;
    out.push({
      row: r,
      date: d,
      month: monthKey(d),
      year: yearOf(d),
      mon: monthOf(d),
      sales: coerceNumber(r[salesField]) || 0,
    });
  }
  return out;
}

function groupSum(annotated, keyFn) {
  const map = new Map();
  for (const a of annotated) {
    const k = keyFn(a);
    if (k == null || k === "") continue;
    map.set(k, (map.get(k) || 0) + a.sales);
  }
  return map;
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  const name = new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${name} ${y}`;
}

function shortMonthLabel(key) {
  const m = +key.slice(5, 7);
  return new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function buildMonthly(annotated, mapping) {
  const byMonth = _.groupBy(annotated, "month");
  const months = Object.keys(byMonth).sort();
  return months.map((m) => {
    const rs = byMonth[m];
    const sales = _.sumBy(rs, "sales");
    const checks = distinctChecks(
      rs.map((a) => a.row),
      mapping.checkId
    );
    return {
      key: m,
      year: +m.slice(0, 4),
      mon: +m.slice(5, 7),
      sales,
      checks,
      avgCheck: checks ? sales / checks : null,
      lines: rs.length,
      label: monthLabel(m),
      shortLabel: shortMonthLabel(m),
    };
  });
}

function priorYearKey(monthKeyStr) {
  const y = +monthKeyStr.slice(0, 4);
  const mon = monthKeyStr.slice(5, 7);
  return `${y - 1}-${mon}`;
}

/**
 * Index points with optional YoY shadow: prior-year same calendar month,
 * also scaled to indexSales (= 100 at the index month).
 */
function toIndexPoints(monthly, indexSales, salesByMonth = null) {
  if (!indexSales) return [];
  const lookup =
    salesByMonth ||
    Object.fromEntries(monthly.map((m) => [m.key, m.sales]));
  return monthly.map((m) => {
    const priorKey = priorYearKey(m.key);
    const priorSales = lookup[priorKey];
    const hasShadow = priorSales != null && priorSales > 0;
    return {
      key: m.key,
      label: m.shortLabel,
      fullLabel: m.label,
      sales: m.sales,
      index: (m.sales / indexSales) * 100,
      checks: m.checks,
      priorYearKey: hasShadow ? priorKey : null,
      priorYearSales: hasShadow ? priorSales : null,
      shadowIndex: hasShadow ? (priorSales / indexSales) * 100 : null,
      yoyDeltaPct: hasShadow ? (m.sales - priorSales) / Math.abs(priorSales) : null,
      yoyDeltaDollars: hasShadow ? m.sales - priorSales : null,
    };
  });
}

function seriesFromPoints(points, valueKey = "index") {
  const total = _.sumBy(points, valueKey) || 0;
  return {
    kind: "series",
    data: points.map((p) => ({
      key: p.label || p.key,
      value: valueKey === "index" ? Math.round(p.index * 10) / 10 : p.sales,
      monthKey: p.key,
      sales: p.sales,
      index: p.index,
      count: p.checks || 0,
      share: total ? (valueKey === "index" ? p.index : p.sales) / total : 0,
    })),
    total,
    allData: [],
    timeMode: true,
  };
}

function slicePre(monthly, indexMonth, window) {
  const pre = monthly.filter((m) => m.key < indexMonth);
  if (window === "last6") return pre.slice(-6);
  return pre;
}

function slicePost(monthly, indexMonth, window) {
  const post = monthly.filter((m) => m.key > indexMonth);
  if (window === "last6") return post.slice(-6);
  return post;
}

/**
 * Score index narrative: thesis + overview from post-index average vs 100
 * and latest month vs 100.
 */
export function scoreIndexNarrative({ index, prePoints, postPoints, indexMonth }) {
  const postAvg =
    postPoints.length > 0 ? _.meanBy(postPoints, "index") : null;
  const latest = postPoints.length ? postPoints[postPoints.length - 1] : null;
  const preAvg = prePoints.length > 0 ? _.meanBy(prePoints, "index") : null;
  const above = postAvg != null && postAvg >= 100;
  const latestAbove = latest != null && latest.index >= 100;

  let thesis;
  if (postAvg == null) {
    thesis = `August ${indexMonth.slice(0, 4)} is set as the sales baseline — load later months to see what came after.`;
  } else if (above && latestAbove) {
    thesis = `Sales climbed after the ${monthLabel(indexMonth)} baseline and stayed above the index.`;
  } else if (above && !latestAbove) {
    thesis = `Sales ran above the ${monthLabel(indexMonth)} index overall, though the latest month slipped back.`;
  } else if (!above && latestAbove) {
    thesis = `The stretch after ${monthLabel(indexMonth)} sat below the index on average, but the latest month crossed back above.`;
  } else {
    thesis = `Sales have not yet retaken the ${monthLabel(indexMonth)} baseline.`;
  }

  const overview = [];
  overview.push(
    `${monthLabel(indexMonth)} net sales of ${fmtCurrency(index.sales)} are indexed to 100 — the pivot for reading everything before and after.`
  );
  if (prePoints.length) {
    overview.push(
      `Setup: the ${prePoints.length} month(s) before the index averaged ${fmtNumber(preAvg)} on the index scale${
        preAvg != null && preAvg < 100 ? ", climbing toward the baseline" : preAvg != null && preAvg > 100 ? ", already running hot into the pivot" : ""
      }.`
    );
  } else {
    overview.push("Setup: no months before the index are loaded yet.");
  }
  overview.push(
    `Conflict: ${monthLabel(indexMonth)} locks the baseline at index 100. This is an intentional pivot, not a collision of series.`
  );
  if (postPoints.length && postAvg != null && latest) {
    const delta = postAvg - 100;
    overview.push(
      `Resolution: after the index, months averaged ${fmtNumber(postAvg)} (${delta >= 0 ? "+" : ""}${fmtNumber(delta)} vs 100). Latest ${latest.fullLabel} sits at ${fmtNumber(latest.index)}.`
    );
  } else {
    overview.push("Resolution: load months after the index to complete the after-state.");
  }

  return { thesis, overview, postAvg, preAvg, latest, above };
}

function suggestSetupTitle(prePoints, indexMonth) {
  if (!prePoints.length) return `Before ${monthLabel(indexMonth)}`;
  const preAvg = _.meanBy(prePoints, "index");
  if (preAvg < 90) return `Climbing toward the ${monthLabel(indexMonth)} mark`;
  if (preAvg < 100) return `Approaching the ${monthLabel(indexMonth)} baseline`;
  return `Already hot heading into ${monthLabel(indexMonth)}`;
}

function suggestConflictTitle(indexMonth) {
  return `${monthLabel(indexMonth)} becomes the baseline (index = 100)`;
}

function suggestResolutionTitle(postPoints, indexMonth) {
  if (!postPoints.length) return `After ${monthLabel(indexMonth)}`;
  const postAvg = _.meanBy(postPoints, "index");
  const latest = postPoints[postPoints.length - 1];
  if (postAvg >= 100 && latest.index >= 100) {
    return `Above the index: ${latest.fullLabel.split(" ")[1] || "later months"} hold the gain`;
  }
  if (postAvg >= 100) return `Above the index on average — latest month cooled`;
  if (latest.index >= 100) return `Latest month retakes the ${monthLabel(indexMonth)} index`;
  return `Still below ${monthLabel(indexMonth)}`;
}

/**
 * Build Setup / Conflict / Resolution StoryDocument indexed to a month's net sales (= 100).
 */
export function buildIndexStory(rows, mapping, options = {}) {
  const indexMonth = options.indexMonth || DEFAULT_INDEX_MONTH;
  const mode = options.mode || "dfy";
  const preWindow = options.preWindow || "all"; // 'all' | 'last6'
  const postWindow = options.postWindow || "all"; // 'all' | 'last6'
  const titleOverrides = options.titleOverrides || {};

  const empty = {
    ready: false,
    reason: null,
    thesis: null,
    index: null,
    setup: null,
    conflict: null,
    resolution: null,
    overview: [],
    mode,
    evidence: null,
    monthly: [],
    span: null,
  };

  const annotated = annotateRows(rows, mapping);
  if (!annotated.length) {
    return {
      ...empty,
      reason: "Need a mapped date and sales column, plus at least one loaded month.",
    };
  }

  const monthly = buildMonthly(annotated, mapping);
  const indexRow = monthly.find((m) => m.key === indexMonth);
  if (!indexRow || !indexRow.sales) {
    const have = monthly.map((m) => m.key).join(", ") || "none";
    return {
      ...empty,
      monthly,
      span: monthly.length ? `${monthly[0].key} → ${monthly[monthly.length - 1].key}` : null,
      reason: `Index month ${indexMonth} is missing or has zero sales. Load the TD file for that month (e.g. 25_08_TD.xlsx). Loaded months: ${have}.`,
    };
  }

  const salesByMonth = Object.fromEntries(monthly.map((m) => [m.key, m.sales]));
  const allIndexed = toIndexPoints(monthly, indexRow.sales, salesByMonth);
  const preMonths = slicePre(monthly, indexMonth, preWindow);
  const postMonths = slicePost(monthly, indexMonth, postWindow);
  const prePoints = toIndexPoints(preMonths, indexRow.sales, salesByMonth);
  const postPoints = toIndexPoints(postMonths, indexRow.sales, salesByMonth);
  const conflictPoints = toIndexPoints([indexRow], indexRow.sales, salesByMonth);

  const scored = scoreIndexNarrative({
    index: indexRow,
    prePoints,
    postPoints,
    indexMonth,
  });

  const setupTitle = titleOverrides.setup || suggestSetupTitle(prePoints, indexMonth);
  const conflictTitle = titleOverrides.conflict || suggestConflictTitle(indexMonth);
  const resolutionTitle = titleOverrides.resolution || suggestResolutionTitle(postPoints, indexMonth);

  const setupCaption =
    prePoints.length > 0
      ? `${prePoints.length} month(s) before the index · avg index ${fmtNumber(scored.preAvg)}`
      : "No pre-index months in the loaded data.";
  const conflictCaption = `${monthLabel(indexMonth)} net sales ${fmtCurrency(indexRow.sales)} locked to index 100.`;
  const resolutionCaption =
    postPoints.length > 0
      ? `${postPoints.length} month(s) after the index · avg index ${fmtNumber(scored.postAvg)}`
      : "No post-index months in the loaded data.";

  const index = {
    month: indexMonth,
    label: monthLabel(indexMonth),
    sales: indexRow.sales,
    value: 100,
  };

  const evidence = {
    measureRole: "netSales",
    groupMode: "month",
    indexMonth,
    preWindow,
    postWindow,
    preMonths: preMonths.map((m) => m.key),
    postMonths: postMonths.map((m) => m.key),
    querySpec: {
      measureField: mapping.netSales,
      measureRole: "netSales",
      measureLabel: "Index (Aug 2025 = 100)",
      agg: "sum",
      groupField: mapping.date,
      groupRole: "date",
      groupLabel: "Month",
      groupMode: "month",
      filters: [],
      topN: 36,
      order: "asc",
      viz: "line",
    },
  };

  return {
    ready: true,
    reason: null,
    thesis: scored.thesis,
    index,
    setup: {
      title: setupTitle,
      caption: setupCaption,
      series: seriesFromPoints(prePoints),
      points: prePoints,
      highlightKeys: [],
      phase: "setup",
    },
    conflict: {
      title: conflictTitle,
      caption: conflictCaption,
      series: seriesFromPoints(conflictPoints),
      points: conflictPoints,
      highlightKeys: [indexMonth],
      phase: "conflict",
    },
    resolution: {
      title: resolutionTitle,
      caption: resolutionCaption,
      series: seriesFromPoints(postPoints),
      points: postPoints,
      highlightKeys: postPoints.length ? [postPoints[postPoints.length - 1].key] : [],
      phase: "resolution",
    },
    overview: scored.overview,
    mode,
    evidence,
    monthly,
    allIndexed,
    span: `${monthly[0].key} → ${monthly[monthly.length - 1].key}`,
    stats: {
      preAvg: scored.preAvg,
      postAvg: scored.postAvg,
      latest: scored.latest,
      above: scored.above,
    },
    suggestedTitles: {
      setup: suggestSetupTitle(prePoints, indexMonth),
      conflict: suggestConflictTitle(indexMonth),
      resolution: suggestResolutionTitle(postPoints, indexMonth),
    },
  };
}

/** Available months + whether the default index month is present. */
export function storyDataReadiness(rows, mapping, indexMonth = DEFAULT_INDEX_MONTH) {
  const annotated = annotateRows(rows, mapping);
  if (!annotated.length) {
    return {
      ready: false,
      hasIndex: false,
      months: [],
      reason: "Load monthly TDIM / TD files with a date and net sales column.",
    };
  }
  const monthly = buildMonthly(annotated, mapping);
  const months = monthly.map((m) => m.key);
  const hasIndex = months.includes(indexMonth);
  return {
    ready: hasIndex,
    hasIndex,
    months,
    span: months.length ? `${months[0]} → ${months[months.length - 1]}` : null,
    reason: hasIndex
      ? null
      : `Missing index month ${indexMonth}. Load TD/${indexMonth.slice(2, 4)}_${indexMonth.slice(5)}_TD.xlsx (or the matching export) so Done-for-you can set the baseline.`,
  };
}

/**
 * Build an ownership-facing Bistro story from loaded transaction rows.
 * Focus: YoY where comparable months exist, MoM pulse, mix movers.
 * Explicitly defers margin / product matrix until COGS lands.
 */
export function buildBistroStory(rows, mapping) {
  const annotated = annotateRows(rows, mapping);
  const empty = {
    ready: false,
    reason: "Need a mapped date and sales column, plus at least one loaded month.",
    headline: null,
    narrative: [],
    yoy: null,
    mom: null,
    positives: [],
    watches: [],
    monthly: [],
    comingSoon: [
      "Sync Reeco invoice unit costs from Airtable into tdim_ingredient_costs.",
      "Join recipe cards on item_number, roll unit cost snapshots, then rank Stars vs Workhorses.",
      "See COGS_AIRTABLE.md for the join contract and product-matrix frame.",
    ],
  };

  if (!annotated.length) return empty;

  const monthly = buildMonthly(annotated, mapping);
  const months = monthly.map((m) => m.key);

  // YoY: compare months that exist in both the latest year and prior year.
  const years = _.uniq(monthly.map((m) => m.year)).sort();
  const latestYear = years[years.length - 1];
  const priorYear = years.includes(latestYear - 1) ? latestYear - 1 : null;

  let yoy = null;
  if (priorYear != null) {
    const latestByMon = Object.fromEntries(
      monthly.filter((m) => m.year === latestYear).map((m) => [m.mon, m])
    );
    const priorByMon = Object.fromEntries(
      monthly.filter((m) => m.year === priorYear).map((m) => [m.mon, m])
    );
    const comparableMonths = Object.keys(latestByMon)
      .map(Number)
      .filter((mon) => priorByMon[mon])
      .sort((a, b) => a - b);

    if (comparableMonths.length) {
      const currSales = _.sumBy(comparableMonths, (mon) => latestByMon[mon].sales);
      const prevSales = _.sumBy(comparableMonths, (mon) => priorByMon[mon].sales);
      const currChecks = _.sumBy(comparableMonths, (mon) => latestByMon[mon].checks || 0);
      const prevChecks = _.sumBy(comparableMonths, (mon) => priorByMon[mon].checks || 0);
      const monthBreakdown = comparableMonths.map((mon) => {
        const c = latestByMon[mon];
        const p = priorByMon[mon];
        return {
          mon,
          label: new Date(Date.UTC(2000, mon - 1, 1)).toLocaleString("en-US", {
            month: "short",
            timeZone: "UTC",
          }),
          current: c.sales,
          prior: p.sales,
          delta: c.sales - p.sales,
          deltaPct: pctDelta(c.sales, p.sales),
        };
      });
      yoy = {
        latestYear,
        priorYear,
        comparableMonths,
        currentSales: currSales,
        priorSales: prevSales,
        deltaSales: currSales - prevSales,
        deltaPct: pctDelta(currSales, prevSales),
        currentChecks: currChecks || null,
        priorChecks: prevChecks || null,
        deltaChecksPct: pctDelta(currChecks, prevChecks),
        monthBreakdown,
      };
    }
  }

  // MoM: last two months in the series.
  let mom = null;
  if (monthly.length >= 2) {
    const curr = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    mom = {
      current: curr,
      prior: prev,
      deltaSales: curr.sales - prev.sales,
      deltaPct: pctDelta(curr.sales, prev.sales),
      deltaAvgCheck: curr.avgCheck != null && prev.avgCheck != null ? curr.avgCheck - prev.avgCheck : null,
    };
  }

  // Dimension movers: YoY on overlapping calendar months, else MoM on latest two months.
  const positives = [];
  const watches = [];

  function compareDim(role, label, limit = 5) {
    const field = mapping[role];
    if (!field) return;
    let currAnn = [];
    let prevAnn = [];
    let mode = null;

    if (yoy && yoy.comparableMonths.length) {
      const set = new Set(yoy.comparableMonths);
      currAnn = annotated.filter((a) => a.year === yoy.latestYear && set.has(a.mon));
      prevAnn = annotated.filter((a) => a.year === yoy.priorYear && set.has(a.mon));
      mode = "yoy";
    } else if (monthly.length >= 2) {
      const currKey = monthly[monthly.length - 1].key;
      const prevKey = monthly[monthly.length - 2].key;
      currAnn = annotated.filter((a) => a.month === currKey);
      prevAnn = annotated.filter((a) => a.month === prevKey);
      mode = "mom";
    } else {
      return;
    }

    const currMap = groupSum(currAnn, (a) => String(a.row[field] ?? "").trim() || "(blank)");
    const prevMap = groupSum(prevAnn, (a) => String(a.row[field] ?? "").trim() || "(blank)");
    const keys = _.uniq([...currMap.keys(), ...prevMap.keys()]);
    const scored = keys
      .map((k) => {
        const c = currMap.get(k) || 0;
        const p = prevMap.get(k) || 0;
        return { key: k, current: c, prior: p, delta: c - p, deltaPct: pctDelta(c, p) };
      })
      .filter((x) => x.current > 0 || x.prior > 0);

    const growers = scored
      .filter((x) => x.delta > 0 && (x.prior === 0 || x.deltaPct == null || x.deltaPct >= 0.05))
      .sort((a, b) => b.delta - a.delta)
      .slice(0, limit);
    const soft = scored
      .filter((x) => x.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 3);

    for (const g of growers) {
      positives.push({
        kind: label,
        mode,
        name: g.key,
        delta: g.delta,
        deltaPct: g.deltaPct,
        current: g.current,
        prior: g.prior,
      });
    }
    for (const s of soft) {
      watches.push({
        kind: label,
        mode,
        name: s.key,
        delta: s.delta,
        deltaPct: s.deltaPct,
        current: s.current,
        prior: s.prior,
      });
    }
  }

  compareDim("menuGroup", "Menu group");
  compareDim("daypart", "Daypart");
  compareDim("itemName", "Item", 8);

  // Headline + narrative for ownership
  const narrative = [];
  let headline = "Bistro performance snapshot";

  if (yoy && yoy.deltaPct != null) {
    const up = yoy.deltaPct >= 0;
    headline = up
      ? `Bistro sales are ${fmtPct(Math.abs(yoy.deltaPct))} ahead of ${yoy.priorYear} on comparable months`
      : `Bistro sales are ${fmtPct(Math.abs(yoy.deltaPct))} behind ${yoy.priorYear} on comparable months`;
    narrative.push(
      `Across ${yoy.comparableMonths.length} overlapping month(s), ${yoy.latestYear} did ${fmtCurrency(yoy.currentSales)} vs ${fmtCurrency(yoy.priorSales)} in ${yoy.priorYear} (${up ? "+" : ""}${fmtCurrency(yoy.deltaSales)}).`
    );
    if (yoy.deltaChecksPct != null) {
      narrative.push(
        `Guest checks moved ${yoy.deltaChecksPct >= 0 ? "+" : ""}${fmtPct(yoy.deltaChecksPct)} YoY on those same months.`
      );
    }
  } else if (mom && mom.deltaPct != null) {
    const up = mom.deltaPct >= 0;
    headline = up
      ? `${mom.current.key} is ${fmtPct(Math.abs(mom.deltaPct))} above ${mom.prior.key}`
      : `${mom.current.key} is ${fmtPct(Math.abs(mom.deltaPct))} below ${mom.prior.key}`;
    narrative.push(
      `Latest month ${mom.current.key}: ${fmtCurrency(mom.current.sales)} vs ${fmtCurrency(mom.prior.sales)} prior (${up ? "+" : ""}${fmtCurrency(mom.deltaSales)}).`
    );
    narrative.push(
      "Load the same months from last year to unlock a true year-over-year ownership story."
    );
  } else {
    headline = `${months.length} month(s) loaded · ${fmtCurrency(sumSales(rows, mapping.netSales))} total sales`;
    narrative.push("Add more months (ideally matching months from last year) to unlock YoY storytelling.");
  }

  const topPos = positives.slice(0, 4);
  if (topPos.length) {
    narrative.push(
      "Bright spots: " +
        topPos
          .map((p) => {
            const pct = p.deltaPct != null ? ` (${p.deltaPct >= 0 ? "+" : ""}${fmtPct(p.deltaPct)})` : "";
            return `${p.name} ${p.delta >= 0 ? "+" : ""}${fmtCurrency(p.delta)}${pct}`;
          })
          .join("; ") +
        "."
    );
  }

  if (watches.length) {
    const w = watches[0];
    narrative.push(
      `Watch: ${w.name} is ${fmtCurrency(w.delta)} vs prior (${w.deltaPct != null ? fmtPct(w.deltaPct) : "n/a"}). Growth is only half the story.`
    );
  }

  narrative.push(
    "Margin and product-matrix storytelling stay offline until COGS joins on item Number."
  );

  return {
    ready: true,
    reason: null,
    headline,
    narrative,
    yoy,
    mom,
    positives: positives.slice(0, 12),
    watches: watches.slice(0, 6),
    monthly,
    span: months[0] + " → " + months[months.length - 1],
    years,
    comingSoon: empty.comingSoon,
  };
}

export function storySeriesFromYoy(yoy) {
  if (!yoy) return null;
  return {
    kind: "series",
    data: yoy.monthBreakdown.map((m) => ({
      key: m.label,
      value: m.current,
      prior: m.prior,
      count: 0,
      share: 0,
    })),
    total: yoy.currentSales,
    allData: [],
    timeMode: true,
  };
}

export function storySeriesFromMonthly(monthly) {
  if (!monthly?.length) return null;
  const total = _.sumBy(monthly, "sales") || 0;
  return {
    kind: "series",
    data: monthly.map((m) => ({
      key: m.key,
      value: m.sales,
      count: m.lines,
      share: total ? m.sales / total : 0,
    })),
    total,
    allData: [],
    timeMode: true,
  };
}

export function fmtDelta(n, money) {
  if (n == null || !isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + (money ? fmtCurrency(n) : fmtNumber(n));
}

export function indexChartSpec(measureLabel = "Index") {
  return {
    measureLabel,
    measureRole: "index",
    groupLabel: "Month",
    viz: "bar",
  };
}

/**
 * Flat rows for CSV export: index series + dollar deficits/surpluses vs index month.
 * Designed to join to catering pace on `month`.
 */
export function buildIndexExportRows(story) {
  if (!story?.ready || !story.allIndexed?.length || !story.index) return [];
  const indexSales = story.index.sales;
  return story.allIndexed.map((p) => {
    const deltaDollars = p.sales - indexSales;
    const deficitDollars = Math.max(0, indexSales - p.sales);
    const surplusDollars = Math.max(0, p.sales - indexSales);
    let zone = "after";
    if (p.key === story.index.month) zone = "index";
    else if (p.key < story.index.month) zone = "before";
    return {
      month: p.key,
      label: p.fullLabel || p.key,
      zone,
      bistro_sales: Math.round(p.sales * 100) / 100,
      index_month: story.index.month,
      index_sales: Math.round(indexSales * 100) / 100,
      index_value: Math.round(p.index * 10) / 10,
      delta_vs_index_pts: Math.round((p.index - 100) * 10) / 10,
      delta_vs_index_dollars: Math.round(deltaDollars * 100) / 100,
      deficit_dollars: Math.round(deficitDollars * 100) / 100,
      surplus_dollars: Math.round(surplusDollars * 100) / 100,
      is_deficit: deficitDollars > 0 ? 1 : 0,
      prior_year_month: p.priorYearKey || "",
      prior_year_sales:
        p.priorYearSales != null ? Math.round(p.priorYearSales * 100) / 100 : "",
      shadow_index: p.shadowIndex != null ? Math.round(p.shadowIndex * 10) / 10 : "",
      yoy_delta_dollars:
        p.yoyDeltaDollars != null ? Math.round(p.yoyDeltaDollars * 100) / 100 : "",
      yoy_delta_pct:
        p.yoyDeltaPct != null ? Math.round(p.yoyDeltaPct * 1000) / 10 : "",
    };
  });
}

export function indexExportToCsv(rows) {
  const cols = [
    "month",
    "label",
    "zone",
    "bistro_sales",
    "index_month",
    "index_sales",
    "index_value",
    "delta_vs_index_pts",
    "delta_vs_index_dollars",
    "deficit_dollars",
    "surplus_dollars",
    "is_deficit",
    "prior_year_month",
    "prior_year_sales",
    "shadow_index",
    "yoy_delta_dollars",
    "yoy_delta_pct",
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}
