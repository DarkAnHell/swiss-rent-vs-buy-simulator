/**
 * Chart rendering using Chart.js.
 * Renders from AGGREGATED stats (mean + min/max band) — never holds individual results.
 */

const COLORS = {
  rent:           { line: "#1F77B4", fill: "rgba(31,119,180,0.05)" },
  buy_keep1st:    { line: "#FF7F0E", fill: "rgba(255,127,14,0.05)" },
  buy_repay1st:   { line: "#E377C2", fill: "rgba(227,119,194,0.05)" },
  buy_let_trig:   { line: "#2CA02C", fill: "rgba(44,160,44,0.05)" },
  buy_let_imm:    { line: "#9467BD", fill: "rgba(148,103,189,0.05)" },
};

const STRATEGY_LABELS = {
  rent: "Rent",
  buy_keep1st: "Buy (Keep 1st mortgage)",
  buy_repay1st: "Buy (Repay 1st mortgage)",
  buy_let_trig: "Buy\u2192Rent-out",
  buy_let_imm: "Buy & Rent-out",
};

// Format CHF values
function fmtCHF(v) {
  if (v == null || isNaN(v)) return "\u2014";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 10e3) return sign + (abs / 1e3).toFixed(0) + "k";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + "k";
  return sign + abs.toFixed(0);
}

// ---- Derive mean/min/max arrays from a series accumulator ----

function deriveSeries(acc, T) {
  const mean = new Array(T + 1);
  const min = new Array(T + 1);
  const max = new Array(T + 1);
  for (let t = 0; t <= T; t++) {
    if (acc.count[t] > 0) {
      mean[t] = acc.sum[t] / acc.count[t];
      min[t] = acc.min[t];
      max[t] = acc.max[t];
    } else {
      mean[t] = NaN;
      min[t] = NaN;
      max[t] = NaN;
    }
  }
  return { mean, min, max };
}

/**
 * Create datasets for an envelope (mean line + min/max fill band).
 */
function envelopeDatasets(derived, key, label) {
  const c = COLORS[key];
  return [
    {
      label: `${label} (min)`,
      data: derived.min,
      borderWidth: 0,
      pointRadius: 0,
      fill: false,
      backgroundColor: "transparent",
    },
    {
      label: `${label} (max)`,
      data: derived.max,
      borderWidth: 0,
      pointRadius: 0,
      fill: "-1",
      backgroundColor: c.fill,
    },
    {
      label,
      data: derived.mean,
      borderColor: c.line,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.1,
    },
  ];
}

const defaultOptions = {
  responsive: true,
  maintainAspectRatio: true,
  animation: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: {
      display: false,
      labels: { filter: (item) => !item.text?.includes("(min)") && !item.text?.includes("(max)") },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${fmtCHF(ctx.parsed.y)}`,
      },
    },
  },
  scales: {
    x: { title: { display: true, text: "Year" }, ticks: { maxTicksLimit: 15 } },
    y: {
      title: { display: true, text: "CHF" },
      ticks: { callback: (v) => fmtCHF(v) },
    },
  },
};

// ---- Event lines — custom plugin (no external dependency) ----

const eventLinesPlugin = {
  id: "eventLines",
  afterDraw(chart) {
    const events = chart.options.plugins?.eventLines;
    if (!events?.length) return;
    const { ctx, chartArea: { top, bottom, left, right }, scales } = chart;
    const xScale = scales.x;
    if (!xScale) return;

    ctx.save();
    // Clip to chart area so lines don't bleed into axes
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();

    // Draw bands first (behind lines)
    for (const ev of events) {
      if (ev.max > ev.min) {
        const x1 = xScale.getPixelForValue(ev.min);
        const x2 = xScale.getPixelForValue(ev.max);
        ctx.fillStyle = ev.color + "18";
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
      }
    }

    // Draw lines
    for (const ev of events) {
      const x = xScale.getPixelForValue(ev.median);
      ctx.beginPath();
      ctx.strokeStyle = ev.color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash(ev.dash);
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw labels — only on first occurrence of each event type, staggered by type
    ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const ROW_H = 13;
    // Count row per unique color (label row = color index % 4)
    const colorRowMap = {};
    let colorIdx = 0;
    events.forEach((ev) => {
      if (ev.showLabel && !(ev.color in colorRowMap)) {
        colorRowMap[ev.color] = colorIdx++ % 4;
      }
    });
    events.forEach((ev) => {
      if (!ev.showLabel) return;
      const x = xScale.getPixelForValue(ev.median);
      const row = colorRowMap[ev.color] ?? 0;
      const yOff = top + 3 + row * ROW_H;
      const labelW = ctx.measureText(ev.label).width;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(x + 2, yOff - 1, labelW + 4, 11);
      ctx.fillStyle = ev.color;
      ctx.fillText(ev.label, x + 4, yOff);
    });

    ctx.restore();
  },
};

Chart.register(eventLinesPlugin);

function mergeOptions(override, events) {
  return {
    ...defaultOptions,
    plugins: {
      ...defaultOptions.plugins,
      ...override?.plugins,
      eventLines: events || [],
    },
    scales: {
      x: { ...defaultOptions.scales.x, ...override?.scales?.x },
      y: { ...defaultOptions.scales.y, ...override?.scales?.y },
    },
  };
}

// ---- Chart instances ----

const charts = {};

function getOrCreate(canvasId, config) {
  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }
  const ctx = document.getElementById(canvasId)?.getContext("2d");
  if (!ctx) return null;
  charts[canvasId] = new Chart(ctx, config);
  return charts[canvasId];
}

// ---- Chart builders from aggregate ----

const SERIES_GROUPS = ["networth", "total_cash_out", "net_cashflow", "invest"];
const STRATEGIES = ["_rent", "_buy", "_buy_repay_first", "_buy_let_trigger", "_buy_let_immediate"];
const STRAT_KEYS = ["rent", "buy_keep1st", "buy_repay1st", "buy_let_trig", "buy_let_imm"];

function envelopeChart(canvasId, agg, group, yLabel, events) {
  const T = agg.T;
  const years = Array.from({ length: T + 1 }, (_, i) => i);
  const datasets = [];
  STRATEGIES.forEach((strat, si) => {
    const acc = agg.seriesData[group + strat];
    if (!acc) return;
    const derived = deriveSeries(acc, T);
    datasets.push(...envelopeDatasets(derived, STRAT_KEYS[si], STRATEGY_LABELS[STRAT_KEYS[si]]));
  });
  return getOrCreate(canvasId, {
    type: "line",
    data: { labels: years, datasets },
    options: mergeOptions({ scales: { y: { title: { text: yLabel } } } }, events),
  });
}

// ---- Public API ----

/**
 * Render all charts from aggregated sweep stats.
 * @param {Object} agg - merged aggregate from sweep workers
 */
export function renderAllCharts(agg, events) {
  if (!agg) return;

  envelopeChart("chart-networth", agg, "networth", "Net Worth (CHF)", events);
  envelopeChart("chart-cashout", agg, "total_cash_out", "Annual Outflow (CHF)", events);
  envelopeChart("chart-cashflow", agg, "net_cashflow", "Net Cash Flow (CHF)", events);
  envelopeChart("chart-liquidity", agg, "invest", "Liquid Assets (CHF)", events);

  renderDeltaChart(agg, events);
  renderDeltaChangeChart(agg, events);
  renderWinShareChart(agg, events);
  renderHistogram(agg);
}

function renderDeltaChart(agg, events) {
  const T = agg.T;
  const years = Array.from({ length: T + 1 }, (_, i) => i);
  const delta = deriveSeries(agg.deltaAcc, T);
  getOrCreate("chart-delta", {
    type: "line",
    data: {
      labels: years,
      datasets: [
        { label: "Min", data: delta.min, borderWidth: 0, pointRadius: 0, fill: false, hidden: true },
        { label: "Max", data: delta.max, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: "rgba(255,127,14,0.15)", hidden: true },
        { label: "Buy\u2212Rent Delta", data: delta.mean, borderColor: "#FF7F0E", borderWidth: 2, pointRadius: 0, fill: false },
        { label: "Zero", data: new Array(T + 1).fill(0), borderColor: "#888", borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false },
      ],
    },
    options: mergeOptions({ scales: { y: { title: { text: "Delta (CHF)" } } } }, events),
  });
}

function renderDeltaChangeChart(agg, events) {
  const T = agg.T;
  const years = Array.from({ length: T + 1 }, (_, i) => i);
  const delta = deriveSeries(agg.deltaAcc, T);
  // Year-over-year change in the buy-rent gap (first difference)
  const change = delta.mean.map((v, t) => (t === 0 ? 0 : v - delta.mean[t - 1]));
  getOrCreate("chart-cumulative", {
    type: "bar",
    data: {
      labels: years,
      datasets: [
        {
          label: "Annual \u0394 Change",
          data: change,
          backgroundColor: change.map((v) => (v >= 0 ? "rgba(44,160,44,0.6)" : "rgba(214,39,40,0.6)")),
          borderWidth: 0,
        },
        { label: "Zero", data: new Array(T + 1).fill(0), type: "line", borderColor: "#888", borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false },
      ],
    },
    options: mergeOptions({ scales: { y: { title: { text: "YoY Gap Change (CHF)" } } } }, events),
  });
}

function renderWinShareChart(agg, events) {
  const T = agg.T;
  const n = agg.totalCount;
  const years = Array.from({ length: T + 1 }, (_, i) => i);
  const buyWinPct = years.map((t) => (agg.buyWinCount[t] / n) * 100);
  getOrCreate("chart-winshare", {
    type: "line",
    data: {
      labels: years,
      datasets: [
        { label: "Buy Win %", data: buyWinPct, borderColor: "#FF7F0E", borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: "rgba(255,127,14,0.1)" },
        { label: "50%", data: new Array(T + 1).fill(50), borderColor: "#888", borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false },
      ],
    },
    options: mergeOptions({
      scales: {
        y: { title: { text: "Buy Win %" }, min: 0, max: 100, ticks: { callback: (v) => v + "%" } },
      },
    }, events),
  });
}

function renderHistogram(agg) {
  const nBins = agg.histBins.length;
  const binLabels = [];
  for (let i = 0; i < nBins; i++) {
    const mid = agg.histMin + (i + 0.5) * agg.histBinWidth;
    binLabels.push(fmtCHF(mid));
  }

  getOrCreate("chart-histogram", {
    type: "bar",
    data: {
      labels: binLabels,
      datasets: [{
        label: "Count",
        data: Array.from(agg.histBins),
        backgroundColor: agg.histBins.map((_, i) => {
          const mid = agg.histMin + (i + 0.5) * agg.histBinWidth;
          return mid >= 0 ? "rgba(255,127,14,0.6)" : "rgba(31,119,180,0.6)";
        }),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: "End Delta (Buy\u2212Rent, CHF)" }, ticks: { maxTicksLimit: 10 } },
        y: { title: { display: true, text: "# Scenarios" } },
      },
    },
  });
}

export function renderSummary(agg) {
  const statsDiv = document.getElementById("summary-stats");
  if (!statsDiv) return;

  const n = agg.totalCount;
  const buyWins = agg.buyWinsTotal;
  const meanDelta = n > 0 ? agg.deltaSum / n : 0;
  const meanBE = agg.beCount > 0 ? agg.beSum / agg.beCount : -1;

  statsDiv.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Scenarios</div>
      <div class="stat-value">${n.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Buy Win Rate</div>
      <div class="stat-value">${((buyWins / n) * 100).toFixed(1)}%</div>
      <div class="stat-detail">${buyWins.toLocaleString()} of ${n.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Mean End Delta</div>
      <div class="stat-value">${fmtCHF(meanDelta)} CHF</div>
      <div class="stat-detail">min: ${fmtCHF(agg.deltaMin)} / max: ${fmtCHF(agg.deltaMax)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Mean Breakeven</div>
      <div class="stat-value">${meanBE >= 0 ? meanBE.toFixed(1) + " years" : "Never"}</div>
      <div class="stat-detail">${agg.beCount.toLocaleString()} of ${n.toLocaleString()} runs break even</div>
    </div>
  `;
}

export function downloadChart(canvasId) {
  const chart = charts[canvasId];
  if (!chart) return;
  const link = document.createElement("a");
  link.download = canvasId + ".png";
  link.href = chart.toBase64Image("image/png", 1);
  link.click();
}

export function destroyAllCharts() {
  for (const [id, chart] of Object.entries(charts)) {
    chart.destroy();
    delete charts[id];
  }
}
