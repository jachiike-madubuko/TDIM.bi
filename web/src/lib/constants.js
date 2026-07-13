export const CHART_COLORS = [
  "#7c8cff",
  "#22d3ee",
  "#d946ef",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#fbbf24",
  "#60a5fa",
  "#f472b6",
  "#2dd4bf",
];

// Canonical F&B roles. Order matters: earlier roles win when headers overlap.
export const ROLE_MATCHERS = [
  ["itemNumber", ["menu item number", "item number", "item no", "item id", "item #", "object number", "plu number", "plu", "sku"]],
  ["checkId", ["guest check", "check number", "check no", "check id", "ticket number", "receipt number", "order number"]],
  ["refInfo", ["reference information line 1", "reference information", "reference info", "ref info", "reference line 1", "reference line", "ref line", "type in text"]],
  ["checkCount", ["check count", "cover count", "guest count", "covers", "guests", "checks", "tickets"]],
  ["quantity", ["item quantity", "qty sold", "quantity sold", "units sold", "quantity", "qty", "units", "count sold", "sold count"]],
  ["grossSales", ["gross sales", "gross sale", "gross amount", "gross revenue", "gross"]],
  ["discount", ["discount amount", "discounts", "discount", "comp amount", "comps", "comp"]],
  ["cost", ["cost of goods sold", "cost of goods", "food cost", "item cost", "unit cost", "cogs", "cost"]],
  ["tax", ["tax amount", "sales tax", "tax"]],
  ["price", ["unit price", "item price", "menu price", "price"]],
  ["netSales", ["net sales", "net sale", "net amount", "net revenue", "check line total", "line total", "sales total", "total sales", "sales amount", "net", "sales", "revenue", "amount", "total"]],
  ["date", ["business date", "transaction date", "order date", "trans date", "posting date", "date"]],
  ["daypart", ["daypart", "day part", "meal period", "service period", "revenue period", "meal"]],
  ["familyGroup", ["family group name", "family group", "sub group", "subgroup", "family"]],
  ["menuGroup", ["major group", "menu group", "major category", "menu category", "product class", "category", "group", "major"]],
  ["itemName", ["menu item name", "menu item", "item name", "item description", "product name", "item", "product", "dish", "description"]],
  ["quarterHour", ["quarter hour", "quarter-hour", "time bucket", "time slot"]],
];

export const MEASURE_LABELS = {
  netSales: "Sales",
  grossSales: "Gross Sales",
  quantity: "Units Sold",
  discount: "Discounts",
  tax: "Tax",
  cost: "Cost",
  price: "Price",
  checkCount: "Checks",
};

export const MEASURE_SYNONYMS = [
  ["quantity", ["units", "unit", "quantity", "qty", "how many", "number sold", "volume", "count of", "items sold", "sold"]],
  ["netSales", ["net sales", "revenue", "sales", "dollars", "income", "money", "how much", "top line", "total sales", "$"]],
  ["grossSales", ["gross"]],
  ["discount", ["discount", "comp", "comps"]],
  ["checkCount", ["checks", "covers", "transactions", "tickets", "orders"]],
];

export const DIM_SYNONYMS = [
  ["daypart", ["daypart", "day part", "meal period", "meal", "service period", "breakfast", "lunch", "dinner", "brunch", "pm snack"]],
  ["menuGroup", ["menu group", "group", "category", "family", "major group", "section", "menu category"]],
  ["familyGroup", ["family group", "sub group", "subgroup"]],
  ["itemName", ["item", "menu item", "product", "dish", "sku", "beer"]],
  ["__time__", ["over time", "trend", "by day", "daily", "by week", "weekly", "by month", "monthly", "by date", "each day", "time"]],
  ["__period__", ["by quarter", "by period", "quarter over quarter", "period over period", "across quarters", "qoq"]],
];

export const ROLE_LABELS = {
  date: "Date",
  checkId: "Check",
  daypart: "Daypart",
  menuGroup: "Menu Group",
  familyGroup: "Family Group",
  itemName: "Item",
  itemNumber: "Item #",
  refInfo: "Type-in ref",
  netSales: "Sales",
  quantity: "Quantity",
  cost: "Cost",
  quarterHour: "Quarter hour",
};
