export function makeSampleData() {
  const beers = ["MIDAS", "LAGUNITAS IPA", "BOZEMAN PALE", "406 SESSION", "GUINNESS", "MODELO"];
  const foods = [
    ["BISON BURGER", "BISTRO CLASSICS", 17],
    ["TROUT PLATE", "BISTRO CLASSICS", 15.5],
    ["HUMMUS", "SOCIAL SNACKS", 11],
    ["CHICKEN BOWL", "BISTRO CLASSICS", 14],
    ["FRIES", "MODIFIERS", 0],
    ["ALMONDS", "GRAB N GO", 2.5],
    ["SALMON", "BISTRO CLASSICS", 19],
    ["HONEY", "MODIFIERS", 0],
  ];
  const wines = [
    ["CH SIMI CHARD", "GLASS WHITE 8 OZ", 15.5],
    ["HOUSE RED", "GLASS RED 8 OZ", 12],
  ];
  const nonalc = [
    ["SAN PELLEGRINO", "BEV NON ALCOHOL", 6.5],
    ["DRIP COFFEE", "BEV NON ALCOHOL", 3.5],
  ];
  const dayparts = ["Breakfast", "Lunch", "PM Snack", "Dinner"];
  const num = { "IPA 1": 4400027, "TYPE IN": 5050016 };
  let nextNo = 4090000;
  const noFor = (n) => num[n] || (num[n] = ++nextNo);
  const rows = [];
  let check = 6800;
  const start = Date.UTC(2026, 3, 1);
  const mk = (date, ck, name, no, total, ref, dp, qh, major, family) => ({
    "Transaction Date and Time": date,
    "Check Number": ck,
    "Menu Item Name": name,
    "Menu Item Number": no,
    "Check Line Total": total,
    "Reference Information Line 1": ref,
    "Cost of Goods Sold Amount": 0,
    "Day Part Name": dp,
    "Quarter Hour": qh,
    "Major Group Name": major,
    "Family Group Name": family,
  });
  for (let day = 0; day < 91; day++) {
    const date = new Date(start + day * 86400000);
    const dow = date.getUTCDay();
    const checksToday = (dow === 5 || dow === 6 ? 30 : 20) + Math.floor(Math.random() * 12);
    for (let c = 0; c < checksToday; c++) {
      check++;
      const dp = dayparts[Math.floor(Math.random() * dayparts.length)];
      const hr = 7 + Math.floor(Math.random() * 15);
      const qh = String(hr).padStart(2, "0") + ":" + ["00", "15", "30", "45"][Math.floor(Math.random() * 4)];
      const lines = 1 + Math.floor(Math.random() * 5);
      for (let l = 0; l < lines; l++) {
        const roll = Math.random();
        if (roll < 0.28) {
          rows.push(mk(date, check, "IPA 1", num["IPA 1"], 7.0, "", dp, qh, "BEER", "BEER REGIONAL CRAFT"));
          const ref = Math.random() < 0.08 ? "HONEY" : beers[Math.floor(Math.random() * beers.length)];
          rows.push(mk(date, check, "TYPE IN", num["TYPE IN"], 0.0, ref, dp, qh, "FOOD", "MODIFIERS"));
        } else if (roll < 0.42) {
          const w = wines[Math.floor(Math.random() * wines.length)];
          rows.push(mk(date, check, w[0], noFor(w[0]), w[2], "", dp, qh, "WINE", w[1]));
        } else if (roll < 0.58) {
          const nz = nonalc[Math.floor(Math.random() * nonalc.length)];
          rows.push(mk(date, check, nz[0], noFor(nz[0]), nz[2], "", dp, qh, "NON ALC", nz[1]));
        } else {
          const f = foods[Math.floor(Math.random() * foods.length)];
          rows.push(mk(date, check, f[0], noFor(f[0]), f[2], "", dp, qh, "FOOD", f[1]));
        }
      }
    }
  }
  return rows;
}
