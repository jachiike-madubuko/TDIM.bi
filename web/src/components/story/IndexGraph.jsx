import { useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";
import { toPng } from "html-to-image";
import { downloadBlob, fmtCurrency, fmtNumber } from "../../lib/helpers";

const MINT = "#2dd4a8";
const MINT_MUTED = "#7dd3c0";
const INK = "#0f172a";
const MUTED = "#64748b";
const GRID = "#e2e8f0";
const AXIS = "#94a3b8";

const tick = { fill: AXIS, fontSize: 11 };
const gridStroke = GRID;

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1.5 font-semibold text-slate-800">{row.fullLabel || label}</div>
      <div className="text-slate-700">
        Bistro: <span className="font-semibold">{fmtNumber(row.index)}</span>
        <span className="text-slate-500"> · {fmtCurrency(row.sales)}</span>
      </div>
      {row.shadowIndex != null ? (
        <div className="mt-1 text-slate-500">
          Same month LY: <span className="font-medium text-slate-700">{fmtNumber(row.shadowIndex)}</span>
          {row.priorYearSales != null ? (
            <span> · {fmtCurrency(row.priorYearSales)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function monthTick(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[+m - 1]} ${y}`;
}

/**
 * Ownership-extract index chart (white card): solid = current vs Aug 2025 index,
 * dashed = same calendar month last year on the same 100 scale.
 * Matches the Pacemaker dual-hotel report style for slide / PDF grabs.
 */
export default function IndexGraph({
  points,
  indexMonth,
  height = 360,
  compact = false,
  showShadow = true,
  title,
  downloadName = "bistro_index_aug2025.png",
}) {
  const cardRef = useRef(null);
  const [exporting, setExporting] = useState(false);

  if (!points?.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
        Load months around the index to see the before / after curve.
      </div>
    );
  }

  const indexLabel = monthTick(indexMonth);
  const chartTitle = title || `Bistro · ${indexLabel} = 100`;

  const data = points.map((p) => {
    let zone = "after";
    if (p.key === indexMonth) zone = "index";
    else if (p.key < indexMonth) zone = "before";
    return {
      name: compact ? p.label || p.key.slice(5) : monthTick(p.key),
      fullLabel: p.fullLabel || monthTick(p.key),
      key: p.key,
      index: Math.round(p.index * 10) / 10,
      shadowIndex:
        p.shadowIndex != null && showShadow ? Math.round(p.shadowIndex * 10) / 10 : null,
      sales: p.sales,
      priorYearSales: p.priorYearSales,
      yoyDeltaPct: p.yoyDeltaPct,
      zone,
    };
  });

  const hasShadow = showShadow && data.some((d) => d.shadowIndex != null);
  const indexTickName = data.find((d) => d.zone === "index")?.name;

  async function handleDownload() {
    if (!cardRef.current || exporting) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      downloadBlob(blob, downloadName);
    } catch (err) {
      console.error("PNG export failed", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleDownload}
          disabled={exporting}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Download PNG"}
        </button>
      </div>

      <div
        ref={cardRef}
        className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm"
        style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{chartTitle}</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
              Solid line is Bistro net sales vs its own {indexLabel} index (100). Dashed line is the same
              calendar month last year on that same index scale.
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
            <span className="h-2 w-2 rounded-full" style={{ background: MINT }} />
            Solid mint = Bistro vs its index
          </span>
          {hasShadow ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <span
                className="inline-block h-0.5 w-4 border-t-2 border-dashed"
                style={{ borderColor: MINT_MUTED }}
              />
              Dashed = same month last year on the 100 scale
            </span>
          ) : null}
        </div>

        <div className="mt-4">
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="name"
                tick={tick}
                interval={data.length > 16 ? Math.floor(data.length / 10) : 0}
                angle={-35}
                textAnchor="end"
                height={64}
                axisLine={{ stroke: GRID }}
                tickLine={false}
              />
              <YAxis
                tick={tick}
                tickFormatter={(v) => fmtNumber(v)}
                width={48}
                axisLine={false}
                tickLine={false}
                domain={[0, "auto"]}
                label={{
                  value: `Index (100 = ${indexLabel})`,
                  angle: -90,
                  position: "insideLeft",
                  style: { fill: MUTED, fontSize: 11 },
                }}
              />
              <Tooltip content={<Tip />} />
              <ReferenceLine
                y={100}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                strokeWidth={1.25}
              />
              {indexTickName ? (
                <ReferenceLine
                  x={indexTickName}
                  stroke="#cbd5e1"
                  strokeWidth={1}
                  label={{
                    value: indexLabel,
                    position: "insideTopLeft",
                    fill: MUTED,
                    fontSize: 10,
                  }}
                />
              ) : null}
              {hasShadow ? (
                <Line
                  type="monotone"
                  dataKey="shadowIndex"
                  name="Bistro · same month LY"
                  stroke={MINT_MUTED}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={{ r: 4, fill: MINT_MUTED, stroke: "#fff", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey="index"
                name="Bistro vs index"
                stroke={MINT}
                strokeWidth={2.5}
                dot={{ r: 3, fill: MINT, stroke: "#fff", strokeWidth: 1.5 }}
                activeDot={{ r: 5, fill: MINT, stroke: "#fff", strokeWidth: 2 }}
                isAnimationActive
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconType="circle"
                wrapperStyle={{ fontSize: 12, color: INK, paddingTop: 8 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
