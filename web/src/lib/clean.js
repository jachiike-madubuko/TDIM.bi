import { buildSchema } from "./schema";

/*
  POS type-in resolution. A generic beer button ("IPA 1") is rung, then a
  "TYPE IN" line is added whose Reference Information Line 1 holds the real beer.
  Moves that reference into Menu Item Name on the IPA 1 line and drops the
  TYPE IN row. Scope is name-targeted (default "IPA 1").
*/
export function cleanTransactions(rawRows, opts) {
  opts = opts || {};
  const targets = (opts.targetNames || ["IPA 1"]).map((s) => s.trim().toUpperCase());
  const typeInName = (opts.typeInName || "TYPE IN").toUpperCase();
  const empty = { ipaLines: 0, resolved: 0, deleted: 0, unpaired: [], flagged: [] };
  if (!rawRows || !rawRows.length) return { rows: rawRows || [], summary: empty };

  const m = buildSchema(rawRows).mapping;
  const keys = Object.keys(rawRows[0]);
  const hk = (kw) => keys.find((h) => h.toLowerCase().includes(kw));
  const nameCol = m.itemName || hk("menu item name") || hk("item name");
  const checkCol = m.checkId || hk("check number") || hk("check");
  const refCol = m.refInfo || hk("reference information") || hk("reference");
  const groupCol = m.menuGroup || hk("major group") || hk("group");

  const summary = { ipaLines: 0, resolved: 0, deleted: 0, unpaired: [], flagged: [], nameCol, refCol, checkCol };
  if (!nameCol) {
    summary.skipped = "No Menu Item Name column found";
    return { rows: rawRows, summary };
  }

  const nm = (r) => String(r[nameCol] == null ? "" : r[nameCol]).trim().toUpperCase();
  const isTypeIn = (r) => nm(r) === typeInName;
  const ck = (r) => (checkCol ? String(r[checkCol]) : "__ALL__");

  const foodNames = new Set();
  if (groupCol) {
    const bev = ["BEER", "WINE", "LIQUOR", "SPIRIT", "COCKTAIL", "NON ALC", "NON-ALC", "BEVERAGE", "BAR"];
    for (const r of rawRows) {
      const g = String(r[groupCol] == null ? "" : r[groupCol]).toUpperCase();
      const name = nm(r);
      if (name && name !== typeInName && !bev.some((x) => g.includes(x))) foodNames.add(name);
    }
  }
  const kitchenPat = /^(86\b|no |sub\b|sub |side |extra |add |light |hold |on side)/i;

  const toDelete = new Set();
  for (let i = 0; i < rawRows.length; i++) {
    if (!targets.includes(nm(rawRows[i]))) continue;
    summary.ipaLines++;
    let paired = false;
    for (let j = i + 1; j < rawRows.length; j++) {
      if (ck(rawRows[j]) !== ck(rawRows[i])) break;
      if (toDelete.has(j)) continue;
      if (isTypeIn(rawRows[j])) {
        const ref = refCol ? String(rawRows[j][refCol] == null ? "" : rawRows[j][refCol]).trim() : "";
        if (ref) {
          rawRows[i] = { ...rawRows[i], [nameCol]: ref };
          toDelete.add(j);
          summary.resolved++;
          summary.deleted++;
          paired = true;
          const up = ref.toUpperCase();
          if (foodNames.has(up) || kitchenPat.test(ref)) {
            summary.flagged.push({
              check: ck(rawRows[i]),
              name: ref,
              reason: foodNames.has(up) ? "matches a food item name" : "looks like a kitchen note",
            });
          }
          break;
        }
      }
    }
    if (!paired) summary.unpaired.push(ck(rawRows[i]));
  }
  const rows = rawRows.filter((_, k) => !toDelete.has(k));
  return { rows, summary };
}
