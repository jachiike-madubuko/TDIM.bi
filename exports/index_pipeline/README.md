# Index pipeline (split ownership)

| Artifact | Owner | Command / prompt |
|---|---|---|
| `bistro_index.csv` + `bistro_index_manifest.json` | TDIM.bi / this repo | `python scripts/export_bistro_index.py --td-dir TD` |
| `catering_fb_index.csv` + manifest | Separate Pacemaker agent | [`prompts/CATERING_FB_INDEX_AGENT.md`](../../prompts/CATERING_FB_INDEX_AGENT.md) |
| Combined overlap / narrative | Third combiner agent | Join on `month` only after both manifests pass validation |

Bistro UI also exports the same column contract via **Export index CSV** on the Story tab.

**Do not** use `exports/story_overlap/*` as source of truth for catering. That path mixed pace pulls inside this repo and is retired for decision-making.
