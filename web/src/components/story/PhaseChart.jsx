import { useRef } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import { downloadSvgAsPng, fmtCurrency, fmtNumber } from "../../lib/helpers";

const tick = { fill: "rgba(244,246,251,0.45)", fontSize: 11 };
const grid = "rgba(255,255,255,0.06)";
const BAR = "rgba(124,140,255,0.85)";
const BAR_HI = "rgba(52,211,153,0.9)";
const BAR_MUTED = "rgba(255,255,255,0.22)";

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/10 bg-[#0c0e18]/92 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
      <div className="mb-1 text-white/50">{row.fullLabel || label}</div>
      <div className="font-semibold text-white">Index {fmtNumber(row.index)}</div>
      <div className="mt-0.5 text-white/45">{fmtCurrency(row.sales)}</div>
    </div>
  );
}

export default function PhaseChart({
  points,
  highlightKeys = [],
  showIndexLine = true,
  height = 260,
  downloadName = "phase_chart.png",
}) {
  const chartRef = useRef(null);

  if (!points?.length) {
    return <div className="py-10 text-center text-sm text-white/35">No months in this phase yet.</div>;
  }

  const hi = new Set(highlightKeys);
  const data = points.map((p) => ({
    name: p.label || p.key,
    index: Math.round(p.index * 10) / 10,
    sales: p.sales,
    fullLabel: p.fullLabel || p.key,
    monthKey: p.key,
    highlight: hi.has(p.key),
  }));

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => downloadSvgAsPng(chartRef.current, downloadName)}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/10"
        >
          Download PNG
        </button>
      </div>
      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis
              dataKey="name"
              tick={tick}
              interval={0}
              angle={data.length > 6 ? -20 : 0}
              textAnchor={data.length > 6 ? "end" : "middle"}
              height={data.length > 6 ? 56 : 30}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={tick}
              tickFormatter={(v) => fmtNumber(v)}
              width={48}
              axisLine={false}
              tickLine={false}
              domain={[0, "auto"]}
            />
            <Tooltip content={<Tip />} />
            {showIndexLine ? (
              <ReferenceLine y={100} stroke="rgba(52,211,153,0.55)" strokeDasharray="4 4" label="" />
            ) : null}
            <Bar dataKey="index" radius={[8, 8, 4, 4]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.highlight ? BAR_HI : d.index >= 100 ? BAR : BAR_MUTED}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
