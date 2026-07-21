import { useMemo, useState } from "react";
import { buildIndexStory, DEFAULT_INDEX_MONTH } from "../../lib/story";
import IndexGraph from "./IndexGraph";
import PhaseChart from "./PhaseChart";

const STEPS = ["setup", "conflict", "resolution"];

function OptionCard({ selected, title, tradeoff, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        selected
          ? "w-full rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-left"
          : "w-full rounded-2xl border border-white/10 bg-white/4 p-4 text-left hover:border-white/25"
      }
    >
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-white/45">{tradeoff}</div>
    </button>
  );
}

export default function StoryDiyWizard({ rows, mapping, onComplete, onCancel }) {
  const [step, setStep] = useState(0);
  const [preWindow, setPreWindow] = useState("all");
  const [postWindow, setPostWindow] = useState("all");
  const [titles, setTitles] = useState({ setup: "", conflict: "", resolution: "" });

  const preview = useMemo(
    () =>
      buildIndexStory(rows, mapping, {
        indexMonth: DEFAULT_INDEX_MONTH,
        mode: "diy",
        preWindow,
        postWindow,
        titleOverrides: {
          setup: titles.setup || undefined,
          conflict: titles.conflict || undefined,
          resolution: titles.resolution || undefined,
        },
      }),
    [rows, mapping, preWindow, postWindow, titles]
  );

  const phaseKey = STEPS[step];
  const phase = preview.ready ? preview[phaseKey] : null;

  function applySuggestedTitle() {
    if (!preview.ready) return;
    setTitles((t) => ({
      ...t,
      [phaseKey]: preview.suggestedTitles[phaseKey],
    }));
  }

  function next() {
    if (!titles[phaseKey] && preview.ready) {
      setTitles((t) => ({
        ...t,
        [phaseKey]: preview.suggestedTitles[phaseKey],
      }));
    }
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    const doc = buildIndexStory(rows, mapping, {
      indexMonth: DEFAULT_INDEX_MONTH,
      mode: "diy",
      preWindow,
      postWindow,
      titleOverrides: {
        setup: titles.setup || preview.suggestedTitles?.setup,
        conflict: titles.conflict || preview.suggestedTitles?.conflict,
        resolution: titles.resolution || preview.suggestedTitles?.resolution,
      },
    });
    onComplete?.(doc);
  }

  if (!preview.ready) {
    return (
      <div className="glass rounded-[1.5rem] p-8 text-center">
        <div className="brand-title text-xl text-white">DIY needs the index month</div>
        <p className="mx-auto mt-3 max-w-md text-sm text-white/50">{preview.reason}</p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-5 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/70"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            DIY · Step {step + 1} of 3 · {phaseKey}
          </div>
          <h2 className="brand-title mt-1 text-2xl text-white">
            {phaseKey === "setup" && "Establish the before"}
            {phaseKey === "conflict" && "Lock the pivot"}
            {phaseKey === "resolution" && "Show the after"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/55"
        >
          Cancel
        </button>
      </div>

      <div className="flex gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={
              i === step
                ? "h-1 flex-1 rounded-full bg-white"
                : i < step
                  ? "h-1 flex-1 rounded-full bg-emerald-400/70"
                  : "h-1 flex-1 rounded-full bg-white/15"
            }
          />
        ))}
      </div>

      {phaseKey === "setup" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <OptionCard
            selected={preWindow === "all"}
            title="All pre-index months"
            tradeoff="More context: the full climb (or slide) into Aug 2025. Best when seasonality matters."
            onClick={() => setPreWindow("all")}
          />
          <OptionCard
            selected={preWindow === "last6"}
            title="6 months before the index"
            tradeoff="Sharper baseline: focuses the setup on the half-year into the pivot. Less noise from older months."
            onClick={() => setPreWindow("last6")}
          />
        </div>
      ) : null}

      {phaseKey === "conflict" ? (
        <div className="glass rounded-[1.35rem] border border-emerald-400/25 bg-emerald-400/5 p-4">
          <div className="text-sm font-semibold text-white">
            August 2025 is locked as the index ( = 100 )
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            This matches the storytelling rule: an index month is an intentional Setup pivot, not a false
            conflict where series collide. You can rename the phase title; the baseline month stays fixed
            for v1.
          </p>
          <p className="mt-2 text-xs text-white/40">
            Index sales: {preview.index.label} · baseline locked
          </p>
        </div>
      ) : null}

      {phaseKey === "resolution" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <OptionCard
            selected={postWindow === "all"}
            title="All post-index months"
            tradeoff="Full arc after Aug 2025 — see whether the gain held across every loaded month."
            onClick={() => setPostWindow("all")}
          />
          <OptionCard
            selected={postWindow === "last6"}
            title="Last 6 months only"
            tradeoff="Recent pulse: useful for ownership updates, weaker if you need the whole after-story."
            onClick={() => setPostWindow("last6")}
          />
        </div>
      ) : null}

      {step === 0 ? (
        <div className="glass rounded-[1.35rem] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
            Full index context
          </div>
          <div className="mt-2">
            <IndexGraph
              points={preview.allIndexed}
              indexMonth={DEFAULT_INDEX_MONTH}
              height={200}
              compact
            />
          </div>
        </div>
      ) : null}

      <div className="glass rounded-[1.35rem] p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-[240px] flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
            Phase title
            <input
              className="mt-1.5 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"
              value={titles[phaseKey] || preview.suggestedTitles[phaseKey]}
              onChange={(e) => setTitles((t) => ({ ...t, [phaseKey]: e.target.value }))}
            />
          </label>
          <button
            type="button"
            onClick={applySuggestedTitle}
            className="rounded-full border border-white/15 px-3 py-2 text-[11px] font-semibold text-white/60 hover:bg-white/8"
          >
            Use suggested title
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">{phase?.caption}</p>
        <div className="mt-4">
          <PhaseChart
            points={phase?.points}
            highlightKeys={phase?.highlightKeys}
            showIndexLine={phaseKey !== "conflict"}
            height={220}
          />
        </div>
      </div>

      <div className="flex justify-between gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/60 disabled:opacity-30"
        >
          Back
        </button>
        <button
          type="button"
          onClick={next}
          className="rounded-full bg-white px-5 py-2 text-xs font-semibold text-[#0b0d16]"
        >
          {step === STEPS.length - 1 ? "Finish story" : "Continue"}
        </button>
      </div>
    </div>
  );
}
