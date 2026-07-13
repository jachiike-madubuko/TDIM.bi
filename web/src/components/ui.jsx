import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { CHART_COLORS } from "../lib/constants";
import { cx, fmtCurrency, fmtNumber, fmtPct, isCurrencyRole } from "../lib/helpers";
import { executeSpec } from "../lib/query";

const tick = { fill: "rgba(244,246,251,0.45)", fontSize: 11 };
const grid = "rgba(255,255,255,0.06)";

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#0c0e18]/92 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
      <div className="mb-1 text-white/50">{label}</div>
      <div className="font-semibold text-white">{formatter(payload[0].value)}</div>
    </div>
  );
}

export function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="glass rise group relative overflow-hidden rounded-[1.15rem] p-4 transition duration-300 hover:-translate-y-0.5 hover:border-white/25">
      <div
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-40 blur-2xl transition group-hover:opacity-70"
        style={{ background: accent || "rgba(124,140,255,0.55)" }}
      />
      <div className="relative">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</div>
        <div className="kpi-value mt-2 text-[1.75rem] text-white">{value}</div>
        {sub ? <div className="mt-1.5 text-xs text-white/40">{sub}</div> : null}
      </div>
    </div>
  );
}

export function Panel({ title, right, children, className }) {
  return (
    <div className={cx("glass rise overflow-hidden rounded-[1.35rem]", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <h3 className="brand-title text-[0.95rem] text-white/90">{title}</h3>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition",
        active
          ? "border-transparent bg-white text-[#0b0d16] shadow-[0_0_20px_rgba(255,255,255,0.25)]"
          : "border-white/12 bg-white/5 text-white/65 hover:border-white/25 hover:bg-white/10 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

export function LabeledSelect({ label, value, onChange, options }) {
  return (
    <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
      <div className="mb-1.5">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select text-sm normal-case tracking-normal">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Chart({ result, spec }) {
  if (!result || result.kind !== "series" || !result.data.length) {
    return <div className="py-10 text-center text-sm text-white/35">No chart for this result.</div>;
  }
  const money = spec.measureRole && isCurrencyRole(spec.measureRole);
  const fmtVal = (v) => (money ? fmtCurrency(v) : fmtNumber(v));
  const data = result.data.map((d) => ({
    name: d.key,
    value: Math.round(d.value * 100) / 100,
    share: d.share,
  }));

  if (spec.viz === "line") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} />
          <XAxis dataKey="name" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} tickFormatter={fmtVal} width={70} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip formatter={fmtVal} />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS[0]}
            strokeWidth={2.5}
            dot={false}
            name={spec.measureLabel}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (spec.viz === "pie") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} stroke="rgba(0,0,0,0.35)" strokeWidth={2}>
            {data.map((_e, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatter={fmtVal} />} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis
          dataKey="name"
          tick={tick}
          interval={0}
          angle={data.length > 6 ? -20 : 0}
          textAnchor={data.length > 6 ? "end" : "middle"}
          height={data.length > 6 ? 60 : 30}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={tick} tickFormatter={fmtVal} width={70} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltip formatter={fmtVal} />} />
        <Bar dataKey="value" name={spec.measureLabel} radius={[8, 8, 4, 4]}>
          {data.map((_e, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ResultTable({ result, spec }) {
  if (!result || result.kind !== "series" || !result.data.length) return null;
  const money = spec.measureRole && isCurrencyRole(spec.measureRole);
  return (
    <div className="scroll-thin mt-3 max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-white/35">
            <th className="py-2 pr-4 font-semibold">{spec.groupLabel}</th>
            <th className="py-2 pr-4 text-right font-semibold">{spec.measureLabel}</th>
            <th className="py-2 pr-4 text-right font-semibold">Share</th>
            <th className="py-2 text-right font-semibold">Lines</th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((d, i) => (
            <tr key={i} className="border-t border-white/6 transition hover:bg-white/4">
              <td className="py-2 pr-4 text-white/80">{d.key}</td>
              <td className="py-2 pr-4 text-right font-semibold text-white">
                {money ? fmtCurrency(d.value) : fmtNumber(d.value)}
              </td>
              <td className="py-2 pr-4 text-right text-white/45">{fmtPct(d.share)}</td>
              <td className="py-2 text-right text-white/35">{fmtNumber(d.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StarterView({ title, spec, rows, mapping, globalFilters, onSave, onCSV }) {
  const result = useMemo(() => {
    try {
      return executeSpec(spec, rows, mapping, globalFilters);
    } catch {
      return null;
    }
  }, [spec, rows, mapping, globalFilters]);
  return (
    <Panel
      title={title}
      right={
        <div className="flex gap-2">
          <button onClick={() => onCSV(result, spec)} className="text-xs font-semibold text-white/40 hover:text-white">
            CSV
          </button>
          <button onClick={() => onSave(title, spec, "starter")} className="text-xs font-semibold text-[#a5b4fc] hover:text-white">
            Save
          </button>
        </div>
      }
    >
      <Chart result={result} spec={spec} />
      <ResultTable result={result} spec={spec} />
    </Panel>
  );
}

export function ChatBubble({ m, onSave, onCSV }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-lg rounded-2xl rounded-br-md bg-gradient-to-br from-[#7c8cff] to-[#d946ef] px-3.5 py-2.5 text-sm font-medium text-white shadow-[0_8px_30px_rgba(168,85,247,0.28)]">
          {m.text}
        </div>
      </div>
    );
  }
  const isCant = m.type === "cantAnswer";
  return (
    <div className="flex justify-start">
      <div
        className={cx(
          "w-full max-w-full rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm",
          isCant
            ? "border border-amber-300/25 bg-amber-400/10 text-amber-100"
            : "border border-white/10 bg-white/6 text-white/80"
        )}
      >
        <div>{m.text}</div>
        {m.result && m.result.kind === "series" ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
            <Chart result={m.result} spec={m.spec} />
            <ResultTable result={m.result} spec={m.spec} />
            <div className="mt-2 flex gap-3">
              <button onClick={() => onCSV(m.result, m.spec)} className="text-xs font-semibold text-white/40 hover:text-white">
                Export CSV
              </button>
              <button
                onClick={() => onSave(m.spec.measureLabel + " by " + m.spec.groupLabel, m.spec, "chat")}
                className="text-xs font-semibold text-[#a5b4fc] hover:text-white"
              >
                Save as view
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
