# Bistro Ownership Story

**Thesis:** Sales have not yet retaken the Aug 2025 baseline.

_Span:_ 2024-08 → 2026-06 · _Index:_ Aug 2025 = 100 ($36,136 net sales) · _Generated:_ 2026-07-21 21:48 UTC

## How to read this

- **Index:** every month is `sales / Aug 2025 sales × 100`. August 2025 is locked at 100.
- **Shadow:** same calendar month last year, also indexed to Aug 2025. Use it to separate seasonality from the post-peak soft stretch.
- **Setup / Conflict / Resolution:** before the pivot, the intentional baseline, and the after-state.

## Main chart

![Index with YoY shadow](exports/ownership_story/charts/index_with_yoy_shadow.png)

## Narrative phases

### Setup — Climbing toward the Aug 2025 mark

The 12 month(s) before the index averaged 73.0 on the index scale. Low point: Dec 2024 at 46.3. High point before the pivot: Aug 2024 at 96.6. Setup is the climb into the intentional baseline.

![Setup](exports/ownership_story/charts/setup.png)

### Conflict — Aug 2025 becomes the baseline (index = 100)

Aug 2025 net sales of $36,136 lock to index 100. This is an intentional pivot for reading everything before and after, not a collision of series. Versus 2024-08, August ran +3.5% ($1,238).

![Conflict](exports/ownership_story/charts/conflict.png)

### Resolution — Still below Aug 2025

After the index, 10 month(s) averaged 62.1 (-37.9 vs 100). Latest Jun 2026 sits at 82.6. Cumulative bistro deficit versus the August mark is $136,973.

![Resolution](exports/ownership_story/charts/resolution.png)

## Ownership snapshot

| Metric | Value |
| --- | --- |
| Index month | Aug 2025 ($36,136) |
| Pre-index avg | 73.0 |
| Post-index avg | 62.1 |
| Latest month | Jun 2026 · 82.6 |
| Cumulative deficit vs index (after) | $136,973 |
| YoY on comparable months | -7.8% (5 ahead / 6 behind) |

## Overview

- Aug 2025 net sales of $36,136 are indexed to 100 — the pivot for reading everything before and after.
- Setup: The 12 month(s) before the index averaged 73.0 on the index scale. Low point: Dec 2024 at 46.3. High point before the pivot: Aug 2024 at 96.6. Setup is the climb into the intentional baseline.
- Conflict: Aug 2025 net sales of $36,136 lock to index 100. This is an intentional pivot for reading everything before and after, not a collision of series. Versus 2024-08, August ran +3.5% ($1,238).
- Resolution: After the index, 10 month(s) averaged 62.1 (-37.9 vs 100). Latest Jun 2026 sits at 82.6. Cumulative bistro deficit versus the August mark is $136,973.
- YoY shadow: On 11 comparable month(s) with a prior-year match (from 2025-08 through 2026-06), current period did $260,524 vs $282,424 prior (-7.8%, -$21,899). 5 month(s) ahead YoY, 6 behind.
- Margin and product-matrix storytelling stay offline until COGS joins on item Number.

## Monthly detail

| Month | Zone | Sales | Index | Prior-year sales | Shadow index | YoY $ | YoY % | Deficit vs index |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aug 2024 | before | $34,898 | 96.6 | — | — | — | — | $1,238 |
| Sep 2024 | before | $30,403 | 84.1 | — | — | — | — | $5,733 |
| Oct 2024 | before | $28,572 | 79.1 | — | — | — | — | $7,564 |
| Nov 2024 | before | $19,138 | 53.0 | — | — | — | — | $16,998 |
| Dec 2024 | before | $16,721 | 46.3 | — | — | — | — | $19,415 |
| Jan 2025 | before | $18,504 | 51.2 | — | — | — | — | $17,632 |
| Feb 2025 | before | $25,920 | 71.7 | — | — | — | — | $10,216 |
| Mar 2025 | before | $25,612 | 70.9 | — | — | — | — | $10,524 |
| Apr 2025 | before | $20,280 | 56.1 | — | — | — | — | $15,856 |
| May 2025 | before | $27,808 | 77.0 | — | — | — | — | $8,328 |
| Jun 2025 | before | $34,568 | 95.7 | — | — | — | — | $1,569 |
| Jul 2025 | before | $34,033 | 94.2 | — | — | — | — | $2,103 |
| Aug 2025 | index | $36,136 | 100.0 | $34,898 | 96.6 | $1,238 | +3.5% | $0 |
| Sep 2025 | after | $31,925 | 88.3 | $30,403 | 84.1 | $1,521 | +5.0% | $4,211 |
| Oct 2025 | after | $28,786 | 79.7 | $28,572 | 79.1 | $214 | +0.8% | $7,350 |
| Nov 2025 | after | $15,329 | 42.4 | $19,138 | 53.0 | -$3,809 | -19.9% | $20,807 |
| Dec 2025 | after | $20,493 | 56.7 | $16,721 | 46.3 | $3,772 | +22.6% | $15,643 |
| Jan 2026 | after | $18,596 | 51.5 | $18,504 | 51.2 | $91 | +0.5% | $17,541 |
| Feb 2026 | after | $22,750 | 63.0 | $25,920 | 71.7 | -$3,170 | -12.2% | $13,386 |
| Mar 2026 | after | $20,698 | 57.3 | $25,612 | 70.9 | -$4,914 | -19.2% | $15,438 |
| Apr 2026 | after | $15,068 | 41.7 | $20,280 | 56.1 | -$5,212 | -25.7% | $21,068 |
| May 2026 | after | $20,884 | 57.8 | $27,808 | 77.0 | -$6,924 | -24.9% | $15,252 |
| Jun 2026 | after | $29,859 | 82.6 | $34,568 | 95.7 | -$4,708 | -13.6% | $6,277 |

## Source

- Measure: Check Line Total after IPA type-in cleaning (`clean_tdim.py`).
- Grain: calendar month.
- Charts for slide decks: also download PNG from the Story Constructor graphs in the web app.

