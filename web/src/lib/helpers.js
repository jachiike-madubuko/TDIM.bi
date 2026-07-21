export function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

export function excelSerialToDate(serial) {
  if (typeof serial !== "number" || !isFinite(serial)) return null;
  if (serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

export function toDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return excelSerialToDate(value);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function coerceNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,%\s]/g, "").replace(/[()]/g, "");
  const neg = /^\(.*\)$/.test(String(v).trim());
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

export function normalizeHeader(h) {
  return String(h == null ? "" : h).trim();
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const currencyFmt2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat("en-US");

export function fmtCurrency(n, precise) {
  if (n == null || !isFinite(n)) return "—";
  return precise ? currencyFmt2.format(n) : currencyFmt.format(n);
}

export function fmtNumber(n) {
  if (n == null || !isFinite(n)) return "—";
  return numFmt.format(Math.round(n * 100) / 100);
}

export function fmtPct(n) {
  if (n == null || !isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

export function fmtDate(d) {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export function isCurrencyRole(role) {
  return ["netSales", "grossSales", "discount", "tax", "cost", "price"].includes(role);
}

export function bucketDate(d, mode) {
  if (!d) return null;
  if (mode === "month") return d.toISOString().slice(0, 7);
  if (mode === "week") {
    const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - onejan) / 86400000 + onejan.getUTCDay() + 1) / 7);
    return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
  }
  return d.toISOString().slice(0, 10);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download the first SVG inside `rootEl` as a PNG (Recharts-friendly).
 * Uses a dark canvas fill so transparent chart backgrounds stay readable.
 */
export function downloadSvgAsPng(rootEl, filename = "chart.png", opts = {}) {
  if (!rootEl) return;
  const svg = rootEl.querySelector("svg");
  if (!svg) return;

  const bg = opts.background || "#0b0d16";
  const scale = opts.scale || 2;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || svg.clientWidth || 800));
  const height = Math.max(1, Math.round(rect.height || svg.clientHeight || 400));

  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(clone);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.scale(scale, scale);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((png) => {
      if (png) downloadBlob(png, filename);
    }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

export function isColumnAllZero(rows, field) {
  if (!field) return false;
  let seen = 0;
  for (const r of rows) {
    const n = coerceNumber(r[field]);
    if (n != null) {
      seen++;
      if (n !== 0) return false;
    }
  }
  return seen > 0;
}
