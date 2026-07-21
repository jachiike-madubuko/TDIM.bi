import { useMemo, useState } from "react";
import _ from "lodash";
import { cx } from "../lib/helpers";
import { Pill } from "./ui";

function dimLabel(role) {
  if (role === "menuGroup") return "Menu group";
  if (role === "daypart") return "Daypart";
  if (role === "familyGroup") return "Family group";
  if (role === "period") return "Period";
  return role;
}

function FilterSection({ id, label, open, onToggle, activeCount, children }) {
  return (
    <div className="border-t border-white/8 first:border-t-0">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition hover:bg-white/4"
      >
        <span className="flex items-center gap-2">
          <span
            className={cx(
              "inline-block text-[10px] text-white/35 transition",
              open && "rotate-90 text-white/60"
            )}
          >
            ▶
          </span>
          <span className="text-[12px] font-semibold text-white/80">{label}</span>
          {activeCount > 0 ? (
            <span className="rounded-full bg-white/12 px-1.5 py-0.5 text-[10px] font-semibold text-white/70">
              {activeCount}
            </span>
          ) : null}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
          {open ? "Hide" : "Choose"}
        </span>
      </button>
      {open ? <div className="px-3.5 pb-3">{children}</div> : null}
    </div>
  );
}

/**
 * Nested filter workflow: compact summary + accordion dimensions.
 * Keeps the main surface clean; opens only the dimension you're editing.
 */
export default function FilterBar({
  rows,
  mapping,
  datasets,
  filterRoles,
  globalFilters,
  hideModifiers,
  onToggleFilter,
  onClearFilters,
  onHideModifiers,
  isFilterActive,
}) {
  const [expanded, setExpanded] = useState(false);
  const [openSection, setOpenSection] = useState(null);

  const optionsByRole = useMemo(() => {
    const out = {};
    for (const role of filterRoles) {
      const field = mapping[role];
      if (!field) continue;
      out[role] = _.uniq(rows.map((r) => String(r[field])).filter((v) => v && v !== "null"))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, role === "familyGroup" ? 24 : 20);
    }
    return out;
  }, [rows, mapping, filterRoles]);

  const activeChips = useMemo(() => {
    const chips = [];
    for (const f of globalFilters) {
      let role = filterRoles.find((r) => mapping[r] === f.field);
      if (f.field === "__period") role = "period";
      for (const v of f.values) {
        chips.push({ field: f.field, value: v, role: role || f.field });
      }
    }
    return chips;
  }, [globalFilters, filterRoles, mapping]);

  const activeCountByRole = useMemo(() => {
    const counts = {};
    for (const chip of activeChips) {
      counts[chip.role] = (counts[chip.role] || 0) + 1;
    }
    return counts;
  }, [activeChips]);

  function toggleSection(id) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  const summary =
    activeChips.length === 0
      ? "All data"
      : `${activeChips.length} filter${activeChips.length === 1 ? "" : "s"} on`;

  return (
    <div className="glass rise overflow-hidden rounded-[1.25rem]">
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
        >
          <span className="text-[10px] text-white/40">{expanded ? "▾" : "▸"}</span>
          Filters
          <span className="text-white/40">·</span>
          <span className={activeChips.length ? "text-emerald-200" : "text-white/45"}>{summary}</span>
        </button>

        {activeChips.slice(0, 4).map((chip) => (
          <button
            key={`${chip.field}:${chip.value}`}
            type="button"
            onClick={() => onToggleFilter(chip.field, chip.value)}
            className="group inline-flex max-w-[160px] items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85"
            title={`Remove ${chip.value}`}
          >
            <span className="truncate">{chip.value}</span>
            <span className="text-white/35 group-hover:text-rose-300">×</span>
          </button>
        ))}
        {activeChips.length > 4 ? (
          <span className="text-[11px] text-white/35">+{activeChips.length - 4} more</span>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-white/45">
            <input
              type="checkbox"
              checked={hideModifiers}
              onChange={(e) => onHideModifiers(e.target.checked)}
              className="accent-[#7c8cff]"
            />
            Hide TYPE IN
          </label>
          {activeChips.length > 0 ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="text-[11px] font-semibold text-rose-300/90 hover:text-rose-200"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-white/8 bg-black/15">
          <p className="px-3.5 pt-3 text-[11px] leading-relaxed text-white/40">
            Open one dimension at a time. Active choices stay as chips above.
          </p>
          {filterRoles.map((role) => {
            const field = mapping[role];
            const opts = optionsByRole[role] || [];
            if (!field || !opts.length) return null;
            return (
              <FilterSection
                key={role}
                id={role}
                label={dimLabel(role)}
                open={openSection === role}
                onToggle={toggleSection}
                activeCount={activeCountByRole[role] || 0}
              >
                <div className="flex flex-wrap gap-1.5">
                  {opts.map((v) => (
                    <Pill key={v} active={isFilterActive(field, v)} onClick={() => onToggleFilter(field, v)}>
                      {v}
                    </Pill>
                  ))}
                </div>
              </FilterSection>
            );
          })}
          {datasets.length > 1 ? (
            <FilterSection
              id="period"
              label="Period"
              open={openSection === "period"}
              onToggle={toggleSection}
              activeCount={activeCountByRole.period || 0}
            >
              <div className="flex flex-wrap gap-1.5">
                {datasets.map((d) => (
                  <Pill
                    key={d.id}
                    active={isFilterActive("__period", d.name)}
                    onClick={() => onToggleFilter("__period", d.name)}
                  >
                    {d.name}
                  </Pill>
                ))}
              </div>
            </FilterSection>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
