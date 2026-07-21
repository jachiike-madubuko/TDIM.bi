import { Chart, KpiCard, Panel } from "./ui";
import { fmtCurrency, fmtPct } from "../lib/helpers";
import { fmtDelta, storySeriesFromMonthly, storySeriesFromYoy } from "../lib/story";

function DeltaBadge({ value }) {
  if (value == null || !isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span
      className={
        up
          ? "rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200"
          : "rounded-full bg-rose-400/15 px-2 py-0.5 text-[11px] font-semibold text-rose-200"
      }
    >
      {up ? "+" : ""}
      {fmtPct(value)}
    </span>
  );
}

export default function StoryView({ story }) {
  if (!story || !story.ready) {
    return (
      <div className="glass rise rounded-[1.5rem] p-8 text-center">
        <div className="brand-title text-2xl text-white">Bistro story</div>
        <p className="mx-auto mt-3 max-w-md text-sm text-white/50">
          {story?.reason ||
            "Load monthly TDIM files (ideally the same months from last year and this year) to generate an ownership narrative."}
        </p>
      </div>
    );
  }

  const yoySeries = storySeriesFromYoy(story.yoy);
  const monthlySeries = storySeriesFromMonthly(story.monthly);
  const yoySpec = {
    measureLabel: String(story.yoy?.latestYear || "Sales"),
    measureRole: "netSales",
    groupLabel: "Month",
    viz: "bar",
  };
  const trendSpec = {
    measureLabel: "Sales",
    measureRole: "netSales",
    groupLabel: "Month",
    viz: "line",
  };

  return (
    <div className="space-y-4">
      <div className="glass rise relative overflow-hidden rounded-[1.6rem] p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(124,140,255,0.28),transparent_42%),radial-gradient(circle_at_85%_80%,rgba(52,211,153,0.16),transparent_40%)]" />
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            Ownership brief · {story.span}
          </div>
          <h2 className="brand-title mt-2 max-w-3xl text-2xl text-white md:text-3xl">{story.headline}</h2>
          <div className="mt-4 space-y-2">
            {story.narrative.map((p, i) => (
              <p key={i} className="max-w-3xl text-sm leading-relaxed text-white/65">
                {p}
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {story.yoy ? (
          <>
            <KpiCard
              label={`${story.yoy.latestYear} (comp.)`}
              value={fmtCurrency(story.yoy.currentSales)}
              sub={`vs ${story.yoy.priorYear}`}
              accent="rgba(124,140,255,0.7)"
            />
            <KpiCard
              label="YoY sales"
              value={fmtDelta(story.yoy.deltaSales, true)}
              sub={<DeltaBadge value={story.yoy.deltaPct} />}
              accent="rgba(52,211,153,0.55)"
            />
            <KpiCard
              label="YoY checks"
              value={
                story.yoy.deltaChecksPct != null
                  ? `${story.yoy.deltaChecksPct >= 0 ? "+" : ""}${fmtPct(story.yoy.deltaChecksPct)}`
                  : "—"
              }
              sub="comparable months"
              accent="rgba(34,211,238,0.5)"
            />
          </>
        ) : null}
        {story.mom ? (
          <KpiCard
            label="MoM pulse"
            value={fmtDelta(story.mom.deltaSales, true)}
            sub={
              <span className="inline-flex items-center gap-2">
                {story.mom.prior.key} → {story.mom.current.key}
                <DeltaBadge value={story.mom.deltaPct} />
              </span>
            }
            accent="rgba(217,70,239,0.45)"
          />
        ) : (
          <KpiCard
            label="Months loaded"
            value={String(story.monthly.length)}
            sub={story.years?.join(" · ")}
            accent="rgba(167,139,250,0.45)"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {yoySeries ? (
          <Panel title={`Comparable months · ${story.yoy.latestYear} vs ${story.yoy.priorYear}`}>
            <Chart result={yoySeries} spec={yoySpec} />
            <div className="scroll-thin mt-3 max-h-56 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-white/35">
                    <th className="py-2 pr-3">Month</th>
                    <th className="py-2 pr-3 text-right">{story.yoy.priorYear}</th>
                    <th className="py-2 pr-3 text-right">{story.yoy.latestYear}</th>
                    <th className="py-2 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {story.yoy.monthBreakdown.map((m) => (
                    <tr key={m.mon} className="border-t border-white/6">
                      <td className="py-2 pr-3 text-white/80">{m.label}</td>
                      <td className="py-2 pr-3 text-right text-white/45">{fmtCurrency(m.prior)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-white">{fmtCurrency(m.current)}</td>
                      <td className="py-2 text-right">
                        <span className={m.delta >= 0 ? "text-emerald-300" : "text-rose-300"}>
                          {fmtDelta(m.delta, true)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <Panel title="Monthly sales pulse">
            <Chart result={monthlySeries} spec={trendSpec} />
          </Panel>
        )}

        <Panel title="Bright spots">
          {story.positives.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/35">
              Not enough overlap yet to rank movers. Add matching months from last year.
            </div>
          ) : (
            <div className="space-y-2">
              {story.positives.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white/90">{p.name}</div>
                    <div className="text-[11px] uppercase tracking-[0.1em] text-white/35">
                      {p.kind} · {p.mode === "yoy" ? "YoY" : "MoM"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-emerald-300">{fmtDelta(p.delta, true)}</div>
                    <DeltaBadge value={p.deltaPct} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {story.watches.length > 0 && (
        <Panel title="Watch list">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {story.watches.map((w, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-rose-400/15 bg-rose-400/5 px-3 py-2.5"
              >
                <div>
                  <div className="font-medium text-white/85">{w.name}</div>
                  <div className="text-[11px] uppercase tracking-[0.1em] text-white/35">{w.kind}</div>
                </div>
                <div className="text-right font-semibold text-rose-300">{fmtDelta(w.delta, true)}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="glass rounded-[1.35rem] border-dashed border-white/15 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
          Next chapter · when COGS lands
        </div>
        <ul className="mt-2 space-y-1.5 text-sm text-white/55">
          {story.comingSoon.map((line, i) => (
            <li key={i}>· {line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
