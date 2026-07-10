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

export function KpiCard({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-400">{sub}</div> : null}
    </div>
  );
}

export function Panel({ title, right, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
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
        "rounded-full border px-2 py-1 text-xs transition-colors",
        active
          ? "border-teal-700 bg-teal-700 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
      )}
    >
      {children}
    </button>
  );
}

export function LabeledSelect({ label, value, onChange, options }) {
  return (
    <label className="text-xs text-slate-500">
      <div className="mb-1">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
      >
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
    return <div className="py-8 text-center text-sm text-slate-400">No chart for this result.</div>;
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
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtVal} width={70} />
          <Tooltip formatter={fmtVal} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
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
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => e.name}>
            {data.map((_e, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={fmtVal} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          interval={0}
          angle={data.length > 6 ? -20 : 0}
          textAnchor={data.length > 6 ? "end" : "middle"}
          height={data.length > 6 ? 60 : 30}
        />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtVal} width={70} />
        <Tooltip formatter={fmtVal} />
        <Bar dataKey="value" name={spec.measureLabel} radius={[3, 3, 0, 0]}>
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
    <div className="mt-3 max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-1 pr-4 font-medium">{spec.groupLabel}</th>
            <th className="py-1 pr-4 text-right font-medium">{spec.measureLabel}</th>
            <th className="py-1 pr-4 text-right font-medium">Share</th>
            <th className="py-1 text-right font-medium">Lines</th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((d, i) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="py-1 pr-4 text-slate-700">{d.key}</td>
              <td className="py-1 pr-4 text-right font-medium text-slate-800">
                {money ? fmtCurrency(d.value) : fmtNumber(d.value)}
              </td>
              <td className="py-1 pr-4 text-right text-slate-500">{fmtPct(d.share)}</td>
              <td className="py-1 text-right text-slate-400">{fmtNumber(d.count)}</td>
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
          <button onClick={() => onCSV(result, spec)} className="text-xs text-slate-500 hover:text-slate-700">
            CSV
          </button>
          <button onClick={() => onSave(title, spec, "starter")} className="text-xs text-teal-700 hover:underline">
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
        <div className="max-w-lg rounded-lg bg-teal-700 px-3 py-2 text-sm text-white">{m.text}</div>
      </div>
    );
  }
  const isCant = m.type === "cantAnswer";
  return (
    <div className="flex justify-start">
      <div
        className={cx(
          "w-full max-w-full rounded-lg px-3 py-2 text-sm",
          isCant ? "border border-amber-200 bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"
        )}
      >
        <div>{m.text}</div>
        {m.result && m.result.kind === "series" ? (
          <div className="mt-3 rounded border border-slate-200 bg-white p-3">
            <Chart result={m.result} spec={m.spec} />
            <ResultTable result={m.result} spec={m.spec} />
            <div className="mt-2 flex gap-3">
              <button onClick={() => onCSV(m.result, m.spec)} className="text-xs text-slate-500 hover:text-slate-700">
                Export CSV
              </button>
              <button
                onClick={() => onSave(m.spec.measureLabel + " by " + m.spec.groupLabel, m.spec, "chat")}
                className="text-xs text-teal-700 hover:underline"
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
