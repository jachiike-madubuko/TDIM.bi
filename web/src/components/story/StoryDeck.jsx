import { useState } from "react";
import { downloadBlob, fmtCurrency, fmtNumber } from "../../lib/helpers";
import { buildIndexExportRows, indexExportToCsv } from "../../lib/story";
import IndexGraph from "./IndexGraph";
import PhaseChart from "./PhaseChart";

const PHASES = [
  { id: "setup", label: "Setup", eyebrow: "Before", blurb: "Baseline reality before the pivot" },
  { id: "conflict", label: "Conflict", eyebrow: "Pivot", blurb: "The intentional index month (= 100)" },
  { id: "resolution", label: "Resolution", eyebrow: "After", blurb: "New reality after the change" },
];

export default function StoryDeck({ story, onEditTitles, onOpenExplore, onStartOver }) {
  const [phase, setPhase] = useState("setup");
  const [showPhases, setShowPhases] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    setup: story.setup?.title || "",
    conflict: story.conflict?.title || "",
    resolution: story.resolution?.title || "",
  });

  if (!story?.ready) return null;

  const active = story[phase];
  const showIndexLine = phase !== "conflict";
  const postAvg = story.stats?.postAvg;
  const preAvg = story.stats?.preAvg;
  const latest = story.stats?.latest;

  function saveTitles() {
    onEditTitles?.(draft);
    setEditing(false);
  }

  function exportIndexCsv() {
    const rows = buildIndexExportRows(story);
    if (!rows.length) return;
    const csv = indexExportToCsv(rows);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "bistro_index.csv");
  }

  const afterDeficit = (story.allIndexed || [])
    .filter((p) => p.key > story.index.month)
    .reduce((s, p) => s + Math.max(0, story.index.sales - p.sales), 0);

  return (
    <div className="space-y-4">
      <div className="glass rise relative overflow-hidden rounded-[1.6rem] p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(52,211,153,0.18),transparent_42%),radial-gradient(circle_at_88%_75%,rgba(124,140,255,0.22),transparent_40%)]" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
              Story complete · {story.mode === "diy" ? "DIY" : "Done-for-you"} · {story.span}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
              >
                {editing ? "Cancel edit" : "Edit titles"}
              </button>
              <button
                type="button"
                onClick={exportIndexCsv}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                title="CSV of index series + dollar deficits for catering join"
              >
                Export index CSV
              </button>
              <button
                type="button"
                disabled
                title="Coming in v1.1"
                className="cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/35"
              >
                Export PDF — v1.1
              </button>
              {onStartOver ? (
                <button
                  type="button"
                  onClick={onStartOver}
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                >
                  New story
                </button>
              ) : null}
            </div>
          </div>
          <h2 className="brand-title mt-3 max-w-3xl text-2xl text-white md:text-3xl">{story.thesis}</h2>
          <p className="mt-2 max-w-2xl text-sm text-white/50">
            {story.index.label} net sales {fmtCurrency(story.index.sales)} locked to index 100. Everything else
            is read relative to that mark.
            {afterDeficit > 0
              ? ` After the index, cumulative bistro deficit vs that mark is ${fmtCurrency(afterDeficit)}.`
              : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Index month" value={story.index.label} sub={fmtCurrency(story.index.sales)} />
        <Stat
          label="Pre-index avg"
          value={preAvg != null ? fmtNumber(preAvg) : "—"}
          sub="index scale"
        />
        <Stat
          label="Post-index avg"
          value={postAvg != null ? fmtNumber(postAvg) : "—"}
          sub={postAvg != null ? (postAvg >= 100 ? "above 100" : "below 100") : "—"}
          accent={postAvg != null && postAvg >= 100 ? "ok" : "warn"}
        />
        <Stat
          label="Latest month"
          value={latest ? fmtNumber(latest.index) : "—"}
          sub={latest?.fullLabel || "—"}
        />
      </div>

      <div className="glass rise rounded-[1.35rem] p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Ownership extract
            </div>
            <p className="mt-1 max-w-xl text-sm text-white/50">
              White report card for slides. Download PNG grabs the full chart with title, chips, and
              legend.
            </p>
          </div>
          {onOpenExplore ? (
            <button
              type="button"
              onClick={onOpenExplore}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/65 hover:bg-white/10"
            >
              Open in Explore
            </button>
          ) : null}
        </div>
        <IndexGraph
          points={story.allIndexed}
          indexMonth={story.index.month}
          height={380}
          title={`Bistro · ${story.index.label} = 100`}
          downloadName="bistro_index_aug2025.png"
        />
      </div>

      {editing ? (
        <div className="glass rounded-[1.35rem] space-y-3 p-4">
          {PHASES.map((p) => (
            <label key={p.id} className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
              {p.label} title
              <input
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"
                value={draft[p.id]}
                onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={saveTitles}
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#0b0d16]"
          >
            Save titles
          </button>
        </div>
      ) : null}

      <div className="glass overflow-hidden rounded-[1.35rem]">
        <button
          type="button"
          onClick={() => setShowPhases((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-white/4"
        >
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Narrative phases
            </div>
            <div className="brand-title mt-0.5 text-lg text-white">Setup · Conflict · Resolution</div>
          </div>
          <span className="text-xs font-semibold text-white/45">{showPhases ? "Collapse" : "Expand"}</span>
        </button>

        {showPhases ? (
          <div className="border-t border-white/8 px-5 pb-5 pt-3">
            <div className="grid gap-2 sm:grid-cols-3">
              {PHASES.map((p) => {
                const selected = phase === p.id;
                const phaseDoc = story[p.id];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPhase(p.id)}
                    className={
                      selected
                        ? "rounded-2xl border border-white/25 bg-white px-3.5 py-3 text-left text-[#0b0d16]"
                        : "rounded-2xl border border-white/10 bg-white/4 px-3.5 py-3 text-left text-white/70 hover:border-white/20"
                    }
                  >
                    <div
                      className={
                        selected
                          ? "text-[10px] font-semibold uppercase tracking-[0.14em] opacity-55"
                          : "text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35"
                      }
                    >
                      {p.eyebrow}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold">{p.label}</div>
                    <div className={selected ? "mt-1 text-[11px] opacity-60" : "mt-1 text-[11px] text-white/40"}>
                      {phaseDoc?.title || p.blurb}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                {PHASES.find((p) => p.id === phase)?.label}
              </div>
              <h3 className="brand-title mt-1 text-xl text-white">{active?.title}</h3>
              <p className="mt-1 text-sm text-white/50">{active?.caption}</p>
              <p className="mt-2 text-xs text-white/35">{PHASES.find((p) => p.id === phase)?.blurb}</p>
              <div className="mt-4">
                <PhaseChart
                  points={active?.points}
                  highlightKeys={active?.highlightKeys}
                  showIndexLine={showIndexLine}
                  downloadName={`bistro_${phase}_chart.png`}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="glass rounded-[1.35rem] p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
          Overview · the so-what
        </div>
        <div className="mt-3 space-y-2">
          {(story.overview || []).map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-white/65">
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  const valueClass =
    accent === "ok"
      ? "text-emerald-300"
      : accent === "warn"
        ? "text-amber-200"
        : "text-white";
  return (
    <div className="glass rounded-[1.15rem] p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">{label}</div>
      <div className={`kpi-value mt-1.5 text-xl ${valueClass}`}>{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-white/40">{sub}</div> : null}
    </div>
  );
}
