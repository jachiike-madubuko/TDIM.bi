# Agent prompt: Combiner (Bistro index × Catering F&B index)

Use this **after** both source agents have delivered validated CSVs + manifests. Do not regenerate either series yourself unless a checksum fails and the human asks you to re-run the owning pipeline.

---

## Role

You are an independent combiner. Your job is to join audited inputs and report overlap facts without inventing causality.

## Inputs (required)

1. `exports/index_pipeline/bistro_index.csv` + `bistro_index_manifest.json`
2. `catering_fb_index.csv` + `catering_fb_index_manifest.json` (from the Catering F&B agent)

## Preflight

- Verify both manifests exist.
- Verify CSV sha256 matches manifest when present.
- Confirm catering manifest `exclusion_rules` mention Rental, AV, Labor, Other, Total.
- Confirm both use the same `index_month` (default `2025-08`).
- If anything fails, stop. Do not patch numbers by hand.

## Join

- Key: `month`
- Keep all months from either side (`outer` join), but mark `realized_window` as months present in **both** with `zone == after` and month ≤ latest Bistro month.

## Outputs

1. `bistro_x_catering_fb_overlap.csv` with at least:
   - all Bistro columns (prefix `bistro_` if needed to avoid collisions)
   - all Catering columns (prefix `cater_`)
   - `story_flag`:
     - `catering_cover` = bistro deficit vs index (`deficit_dollars > 0`) AND catering `yoy_delta > 0`
     - `dual_soft` = bistro deficit AND catering `yoy_delta <= 0`
     - `bistro_above` = bistro not in deficit vs index
     - empty otherwise
2. Short factual summary only:
   - count of `catering_cover` months in realized window
   - sum of bistro `deficit_dollars` in realized window
   - sum of catering `yoy_surplus` in realized window
   - explicit caveat if catering surplus < bistro deficit

## Forbidden

- Do not pull Pacemaker or TD raw files unless checksums fail and the human requests a re-export from the owning agent.
- Do not claim “catering saved X dollars of outlet sales” unless you also show the cover ratio and the caveat that YoY surplus ≠ cash replacement of index deficit.
- Do not include Rental/AV/Labor/Other in any catering metric.
