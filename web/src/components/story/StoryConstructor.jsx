import { useMemo, useState } from "react";
import { downloadBlob, fmtCurrency, fmtNumber } from "../../lib/helpers";
import {
  buildIndexExportRows,
  buildIndexStory,
  DEFAULT_INDEX_MONTH,
  indexExportToCsv,
  storyDataReadiness,
} from "../../lib/story";
import IndexGraph from "./IndexGraph";
import StoryDeck from "./StoryDeck";
import StoryDiyWizard from "./StoryDiyWizard";

export default function StoryConstructor({
  rows,
  mapping,
  onOpenExplore,
  onRequestLoad,
  onLoadSample,
}) {
  const [story, setStory] = useState(null);
  const [diy, setDiy] = useState(false);
  const [buildError, setBuildError] = useState("");

  const readiness = useMemo(
    () => storyDataReadiness(rows, mapping, DEFAULT_INDEX_MONTH),
    [rows, mapping]
  );

  const preview = useMemo(() => {
    if (!readiness.hasIndex) return null;
    return buildIndexStory(rows, mapping, {
      indexMonth: DEFAULT_INDEX_MONTH,
      mode: "dfy",
      preWindow: "all",
      postWindow: "all",
    });
  }, [rows, mapping, readiness.hasIndex]);

  function startDfy() {
    const doc =
      preview?.ready
        ? preview
        : buildIndexStory(rows, mapping, {
            indexMonth: DEFAULT_INDEX_MONTH,
            mode: "dfy",
            preWindow: "all",
            postWindow: "all",
          });
    setDiy(false);
    if (doc.ready) {
      setBuildError("");
      setStory({ ...doc, mode: "dfy" });
    } else {
      setStory(null);
      setBuildError(doc.reason || readiness.reason || "Could not build the Done-for-you story.");
    }
  }

  function startDiy() {
    setBuildError("");
    setDiy(true);
    setStory(null);
  }

  function reset() {
    setStory(null);
    setDiy(false);
    setBuildError("");
  }

  function patchTitles(draft) {
    if (!story?.ready) return;
    setStory(
      buildIndexStory(rows, mapping, {
        indexMonth: story.index.month,
        mode: story.mode,
        preWindow: story.evidence?.preWindow || "all",
        postWindow: story.evidence?.postWindow || "all",
        titleOverrides: draft,
      })
    );
  }

  function exportPreviewIndex() {
    if (!preview?.ready) return;
    const csv = indexExportToCsv(buildIndexExportRows(preview));
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "bistro_index.csv");
  }

  if (story?.ready) {
    return (
      <StoryDeck
        story={story}
        onEditTitles={patchTitles}
        onOpenExplore={onOpenExplore}
        onStartOver={reset}
      />
    );
  }

  if (diy) {
    return (
      <StoryDiyWizard
        rows={rows}
        mapping={mapping}
        onComplete={(doc) => {
          setStory(doc);
          setDiy(false);
        }}
        onCancel={reset}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass rise relative overflow-hidden rounded-[1.6rem] p-6 md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(124,140,255,0.26),transparent_42%),radial-gradient(circle_at_90%_80%,rgba(52,211,153,0.14),transparent_40%)]" />
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            Story Constructor · Setup · Conflict · Resolution
          </div>
          <h2 className="brand-title mt-2 max-w-2xl text-3xl text-white md:text-4xl">
            Read the business against one index month
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">
            Net sales for {DEFAULT_INDEX_MONTH} = 100. The graph below is the whole story spine: climb into the
            pivot, then what held after. Pick DIY or Done-for-you to turn it into a three-phase narrative.
          </p>
          {readiness.span ? (
            <p className="mt-3 text-xs text-white/40">
              Loaded span: {readiness.span} · {readiness.months.length} month(s)
              {readiness.hasIndex ? " · Aug 2025 index ready" : ""}
            </p>
          ) : null}
        </div>
      </div>

      {!readiness.hasIndex ? (
        <div className="glass rounded-[1.35rem] border border-amber-400/25 bg-amber-400/5 p-5">
          <div className="text-sm font-semibold text-amber-100">Index month missing</div>
          <p className="mt-2 text-sm text-white/60">{readiness.reason}</p>
          <p className="mt-2 text-xs text-white/40">
            Tip: select every file in the TD folder (Aug 2024–Jun 2026) via Load files, or run{" "}
            <code className="text-white/55">python scripts/load_tdim_to_supabase.py TD/*.xlsx</code>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {onRequestLoad ? (
              <button
                type="button"
                onClick={onRequestLoad}
                className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#0b0d16]"
              >
                Load TD files
              </button>
            ) : null}
            {onLoadSample ? (
              <button
                type="button"
                onClick={onLoadSample}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/10"
              >
                Preview sample (incl. Aug 2025)
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="glass rise rounded-[1.35rem] p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Easy index graph
              </div>
              <h3 className="brand-title mt-1 text-xl text-white">
                {preview?.index?.label || "Aug 2025"} = 100
              </h3>
              <p className="mt-1 text-sm text-white/45">
                {preview?.index
                  ? `${fmtCurrency(preview.index.sales)} net sales is the baseline. Pre avg ${
                      preview.stats?.preAvg != null ? fmtNumber(preview.stats.preAvg) : "—"
                    } · Post avg ${
                      preview.stats?.postAvg != null ? fmtNumber(preview.stats.postAvg) : "—"
                    }.`
                  : "Indexed monthly sales."}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {preview?.thesis ? (
                <p className="max-w-md text-right text-xs leading-relaxed text-white/50">{preview.thesis}</p>
              ) : null}
              <button
                type="button"
                onClick={exportPreviewIndex}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
              >
                Export index CSV
              </button>
            </div>
          </div>
          <div className="mt-4">
            <IndexGraph
              points={preview?.allIndexed || []}
              indexMonth={DEFAULT_INDEX_MONTH}
              height={360}
              title="Bistro · Aug 2025 = 100"
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/35">
            Export matches <code className="text-white/50">exports/index_pipeline/bistro_index.csv</code>. Catering
            F&B is a separate agent; see <code className="text-white/50">prompts/CATERING_FB_INDEX_AGENT.md</code>.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={startDiy}
          disabled={!readiness.hasIndex}
          className="glass rise rounded-[1.5rem] p-6 text-left transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            For analysts
          </div>
          <div className="brand-title mt-2 text-2xl text-white">DIY constructor</div>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            Walk Setup, Conflict, and Resolution. Pick window tradeoffs, preview each phase chart, and
            name titles before you ship the deck.
          </p>
        </button>

        <button
          type="button"
          onClick={startDfy}
          disabled={!readiness.hasIndex}
          className="glass rise rounded-[1.5rem] p-6 text-left transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300/70">
            For owners
          </div>
          <div className="brand-title mt-2 text-2xl text-white">Done-for-you</div>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            Auto-build the three-phase deck from this index graph: thesis, phase titles, and overview
            ready to review.
          </p>
        </button>
      </div>

      {buildError ? (
        <div className="rounded-[1.2rem] border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-100/80">
          {buildError}
        </div>
      ) : null}
    </div>
  );
}
