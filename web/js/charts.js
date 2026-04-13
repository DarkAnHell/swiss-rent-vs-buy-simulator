/**
 * Chart rendering using Apache ECharts.
 * Renders from AGGREGATED stats (mean + min/max envelope band).
 *
 * Features:
 *   - Beautiful defaults (smooth lines, soft envelopes, dark/light aware)
 *   - Synced crosshair across all charts via echarts.connect(group)
 *   - Range zoom via dataZoom (inside + mouse wheel on all charts,
 *     slider on the first one only to avoid clutter)
 *   - Event-line markers (retirement / capex / crashes) via markLine
 */

const ECHARTS_GROUP = "house-buy-sim";

// ---- Colour palette ----

const COLORS = {
  rent:         "#1F77B4",
  buy_keep1st:  "#FF7F0E",
  buy_repay1st: "#E377C2",
  buy_let_trig: "#2CA02C",
  buy_let_imm:  "#9467BD",
};

const STRATEGY_LABELS = {
  rent: "Rent",
  buy_keep1st: "Buy (Keep 1st mortgage)",
  buy_repay1st: "Buy (Repay 1st mortgage)",
  buy_let_trig: "Buy\u2192Rent-out",
  buy_let_imm: "Buy & Rent-out",
};

const SERIES_GROUPS = ["networth", "total_cash_out", "net_cashflow", "invest"];
const STRATEGIES = ["_rent", "_buy", "_buy_repay_first", "_buy_let_trigger", "_buy_let_immediate"];
const STRAT_KEYS = ["rent", "buy_keep1st", "buy_repay1st", "buy_let_trig", "buy_let_imm"];

// ---- Visibility state (shared across all charts) ----
const visibility = {
  rent: true,
  buy_keep1st: true,
  buy_repay1st: true,
  buy_let_trig: true,
  buy_let_imm: true,
  bands: true,
};

// Remember the last rendered aggregate + events so we can re-render on toggle
let lastAgg = null;
let lastEvents = null;

// ---- Formatting ----

function fmtCHF(v) {
  if (v == null || isNaN(v)) return "\u2014";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 10e3) return sign + (abs / 1e3).toFixed(0) + "k";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + "k";
  return sign + abs.toFixed(0);
}

// Convert hex colour (#RRGGBB) → rgba string with alpha
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Theme-aware colours ----

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function themeColors() {
  const dark = isDark();
  return {
    text:       dark ? "#c9cdd1" : "#2c2c2c",
    textMuted:  dark ? "#909399" : "#6b7280",
    axisLine:   dark ? "#3e4045" : "#d1d5db",
    split:      dark ? "#2c2d32" : "#eef0f3",
    bg:         dark ? "#25262b" : "#ffffff",
    tooltipBg:  dark ? "rgba(30,31,34,0.95)" : "rgba(255,255,255,0.97)",
    tooltipBorder: dark ? "#3e4045" : "#d1d5db",
  };
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
      mean[t] = null;
      min[t] = null;
      max[t] = null;
    }
  }
  return { mean, min, max };
}

// ---- Event lines → ECharts markLine ----

function eventsToMarkLine(events) {
  if (!events || events.length === 0) return undefined;
  const lines = [];
  for (const ev of events) {
    lines.push({
      xAxis: ev.median,
      lineStyle: { color: ev.color, width: 1.2, type: [ev.dash?.[0] || 6, ev.dash?.[1] || 3] },
      label: ev.showLabel ? {
        show: true,
        formatter: ev.label,
        color: ev.color,
        fontSize: 9,
        position: "insideStartTop",
        backgroundColor: isDark() ? "rgba(37,38,43,0.85)" : "rgba(255,255,255,0.85)",
        padding: [1, 3],
        borderRadius: 2,
      } : { show: false },
    });
  }
  return {
    symbol: "none",
    silent: true,
    animation: false,
    data: lines,
  };
}

function eventsToMarkArea(events) {
  if (!events || events.length === 0) return undefined;
  const areas = [];
  for (const ev of events) {
    if (ev.max > ev.min) {
      areas.push([
        { xAxis: ev.min, itemStyle: { color: hexToRgba(ev.color, 0.08) } },
        { xAxis: ev.max },
      ]);
    }
  }
  if (areas.length === 0) return undefined;
  return {
    silent: true,
    animation: false,
    data: areas,
  };
}

// ---- Default chart options ----

function baseOption(events) {
  const tc = themeColors();
  const mkLine = eventsToMarkLine(events);
  const mkArea = eventsToMarkArea(events);
  return {
    tc,            // stash for later reference
    mkLine,
    mkArea,
    _events: events,
  };
}

function gridOption(withSlider) {
  return {
    left: 58,
    right: 18,
    top: 16,
    bottom: withSlider ? 64 : 38,
    containLabel: false,
  };
}

function axisCommon(tc) {
  return {
    xAxis: {
      type: "category",
      boundaryGap: false,
      axisLine: { lineStyle: { color: tc.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: tc.textMuted, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tc.textMuted, fontSize: 11, formatter: (v) => fmtCHF(v) },
      splitLine: { lineStyle: { color: tc.split, type: "dashed" } },
    },
  };
}

function tooltipCommon(tc) {
  return {
    trigger: "axis",
    axisPointer: {
      type: "line",
      lineStyle: { color: tc.textMuted, width: 1, type: "dashed" },
      label: {
        backgroundColor: tc.tooltipBorder,
        color: tc.text,
        fontSize: 11,
      },
    },
    backgroundColor: tc.tooltipBg,
    borderColor: tc.tooltipBorder,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: tc.text, fontSize: 11 },
    extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.12); max-width: 320px;",
    confine: true,
    formatter: (params) => {
      if (!params || !params.length) return "";
      const year = params[0].axisValueLabel ?? params[0].axisValue;
      // Keep only the "mean" series (drop envelope bands and markLine entries)
      const rows = params
        .filter((p) => !p.seriesName?.endsWith("__band") && p.value != null && p.componentType !== "markLine")
        .map((p) => {
          const colour = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:6px;"></span>`;
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;"><span>${colour}${p.seriesName}</span><b style="margin-left:8px;">${fmtCHF(p.value)}</b></div>`;
        })
        .join("");
      return `<div style="font-weight:600;margin-bottom:4px;">Year ${year}</div>${rows}`;
    },
  };
}

function dataZoomCommon(withSlider) {
  const zooms = [
    {
      type: "inside",
      xAxisIndex: 0,
      filterMode: "weakFilter",
      zoomOnMouseWheel: true,
      moveOnMouseMove: "shift",
      moveOnMouseWheel: false,
    },
  ];
  if (withSlider) {
    zooms.push({
      type: "slider",
      xAxisIndex: 0,
      height: 18,
      bottom: 6,
      borderColor: "transparent",
      backgroundColor: isDark() ? "rgba(55,56,60,0.3)" : "rgba(240,242,245,0.6)",
      fillerColor: isDark() ? "rgba(76,139,245,0.2)" : "rgba(59,130,246,0.15)",
      handleStyle: { color: isDark() ? "#4c8bf5" : "#3b82f6" },
      moveHandleStyle: { color: isDark() ? "#4c8bf5" : "#3b82f6" },
      showDetail: false,
      dataBackground: {
        lineStyle: { color: isDark() ? "#3e4045" : "#d1d5db", width: 1 },
        areaStyle: { color: isDark() ? "rgba(76,139,245,0.08)" : "rgba(59,130,246,0.06)" },
      },
      textStyle: { color: themeColors().textMuted, fontSize: 10 },
    });
  }
  return zooms;
}

// ---- Envelope series builder ----

// To draw a filled min/max band we use the stack trick:
//   series1 = min          (transparent line, invisibly holds the base)
//   series2 = max - min    (area filled, stacked on series1)
//   series3 = mean         (solid line on top)
// Additional solo min & max dashed border lines give the envelope a crisp edge.
function envelopeSeries(derived, key, label) {
  const colour = COLORS[key];
  const showBands = visibility.bands;

  const bandMin = derived.min.map((v, i) => (v == null || derived.max[i] == null ? null : v));
  const bandMax = derived.max.map((v, i) => (v == null || derived.min[i] == null ? null : v));
  const bandDiff = derived.min.map((v, i) => {
    if (v == null || derived.max[i] == null) return null;
    return derived.max[i] - v;
  });

  const out = [];

  if (showBands) {
    // 1) transparent baseline at min (for stacking)
    out.push({
      name: label + "__band",
      type: "line",
      data: bandMin,
      stack: "band-" + key,
      lineStyle: { opacity: 0 },
      symbol: "none",
      showSymbol: false,
      silent: true,
      tooltip: { show: false },
      z: 1,
    });
    // 2) filled band (max - min)
    out.push({
      name: label + "__band",
      type: "line",
      data: bandDiff,
      stack: "band-" + key,
      lineStyle: { opacity: 0 },
      areaStyle: { color: hexToRgba(colour, 0.18), opacity: 1 },
      symbol: "none",
      showSymbol: false,
      silent: true,
      tooltip: { show: false },
      smooth: 0.25,
      z: 1,
    });
    // 3) dashed min edge
    out.push({
      name: label + "__band",
      type: "line",
      data: bandMin,
      lineStyle: { color: hexToRgba(colour, 0.55), width: 1, type: [3, 3] },
      symbol: "none",
      showSymbol: false,
      silent: true,
      tooltip: { show: false },
      smooth: 0.25,
      z: 2,
    });
    // 4) dashed max edge
    out.push({
      name: label + "__band",
      type: "line",
      data: bandMax,
      lineStyle: { color: hexToRgba(colour, 0.55), width: 1, type: [3, 3] },
      symbol: "none",
      showSymbol: false,
      silent: true,
      tooltip: { show: false },
      smooth: 0.25,
      z: 2,
    });
  }

  // 5) mean line on top (always shown for enabled strategies)
  out.push({
    name: label,
    type: "line",
    data: derived.mean,
    lineStyle: { color: colour, width: 2.4 },
    itemStyle: { color: colour },
    symbol: "circle",
    symbolSize: 0,
    showSymbol: false,
    emphasis: { focus: "series", lineStyle: { width: 3 } },
    smooth: 0.25,
    z: 3,
  });

  return out;
}

// ---- Chart registry ----

const charts = {};

function getOrCreate(canvasId) {
  if (charts[canvasId]) return charts[canvasId];
  const el = document.getElementById(canvasId);
  if (!el) return null;
  const inst = echarts.init(el, null, { renderer: "canvas" });
  inst.group = ECHARTS_GROUP;
  charts[canvasId] = inst;
  return inst;
}

function applyMarkers(series, mkLine, mkArea) {
  // Attach markLine/markArea to the first visible series so they render once
  if (!series || series.length === 0) return series;
  let attached = false;
  for (const s of series) {
    if (s.silent || s.tooltip?.show === false) continue;
    s.markLine = mkLine;
    s.markArea = mkArea;
    attached = true;
    break;
  }
  if (!attached) {
    series[0].markLine = mkLine;
    series[0].markArea = mkArea;
  }
  return series;
}

// ---- Envelope chart (networth / cashout / cashflow / liquidity) ----

function envelopeChart(canvasId, agg, group, yLabel, events, withSlider) {
  const T = agg.T;
  const years = Array.from({ length: T + 1 }, (_, i) => String(i));
  const allSeries = [];
  STRATEGIES.forEach((strat, si) => {
    const key = STRAT_KEYS[si];
    if (!visibility[key]) return; // strategy toggled off
    const acc = agg.seriesData[group + strat];
    if (!acc) return;
    const derived = deriveSeries(acc, T);
    allSeries.push(...envelopeSeries(derived, key, STRATEGY_LABELS[key]));
  });

  const tc = themeColors();
  const mkLine = eventsToMarkLine(events);
  const mkArea = eventsToMarkArea(events);
  applyMarkers(allSeries, mkLine, mkArea);

  const axes = axisCommon(tc);
  axes.xAxis.data = years;
  axes.yAxis.name = yLabel;
  axes.yAxis.nameLocation = "middle";
  axes.yAxis.nameGap = 45;
  axes.yAxis.nameTextStyle = { color: tc.textMuted, fontSize: 11 };

  const option = {
    animation: true,
    animationDuration: 300,
    grid: gridOption(withSlider),
    tooltip: tooltipCommon(tc),
    xAxis: axes.xAxis,
    yAxis: axes.yAxis,
    dataZoom: dataZoomCommon(withSlider),
    series: allSeries,
  };

  const inst = getOrCreate(canvasId);
  if (inst) inst.setOption(option, { notMerge: true });
  return inst;
}

// ---- Public API ----

export function renderAllCharts(agg, events) {
  if (!agg) return;
  lastAgg = agg;
  lastEvents = events;

  envelopeChart("chart-networth",  agg, "networth",       "Net Worth (CHF)",       events, true);
  envelopeChart("chart-cashout",   agg, "total_cash_out", "Annual Outflow (CHF)",  events, false);
  envelopeChart("chart-cashflow",  agg, "net_cashflow",   "Net Cash Flow (CHF)",   events, false);
  envelopeChart("chart-liquidity", agg, "invest",         "Liquid Assets (CHF)",   events, false);

  renderDeltaChart(agg, events);
  renderDeltaChangeChart(agg, events);
  renderWinShareChart(agg, events);
  renderHistogram(agg);

  // Connect all charts in the group so tooltip & dataZoom sync
  echarts.connect(ECHARTS_GROUP);
}

// ---- Toggle API (called from app.js on legend clicks) ----

// Re-render only the four envelope charts (delta/winshare/histogram don't depend
// on strategy visibility). Preserves current dataZoom state on each chart.
function rerenderEnvelopes() {
  if (!lastAgg) return;
  const zoomState = {};
  const ids = ["chart-networth", "chart-cashout", "chart-cashflow", "chart-liquidity"];
  for (const id of ids) {
    const inst = charts[id];
    if (!inst) continue;
    const opt = inst.getOption();
    if (opt.dataZoom && opt.dataZoom.length) {
      zoomState[id] = { start: opt.dataZoom[0].start, end: opt.dataZoom[0].end };
    }
  }

  envelopeChart("chart-networth",  lastAgg, "networth",       "Net Worth (CHF)",       lastEvents, true);
  envelopeChart("chart-cashout",   lastAgg, "total_cash_out", "Annual Outflow (CHF)",  lastEvents, false);
  envelopeChart("chart-cashflow",  lastAgg, "net_cashflow",   "Net Cash Flow (CHF)",   lastEvents, false);
  envelopeChart("chart-liquidity", lastAgg, "invest",         "Liquid Assets (CHF)",   lastEvents, false);

  // Restore zoom so user's range selection isn't lost on toggle
  for (const id of ids) {
    if (!zoomState[id]) continue;
    const inst = charts[id];
    if (!inst) continue;
    inst.dispatchAction({
      type: "dataZoom",
      start: zoomState[id].start,
      end: zoomState[id].end,
    });
  }

  echarts.connect(ECHARTS_GROUP);
}

export function setStrategyEnabled(key, enabled) {
  if (!(key in visibility)) return;
  visibility[key] = !!enabled;
  rerenderEnvelopes();
}

export function setBandsEnabled(enabled) {
  visibility.bands = !!enabled;
  rerenderEnvelopes();
}

export function getVisibility() {
  return { ...visibility };
}

function renderDeltaChart(agg, events) {
  const T = agg.T;
  const years = Array.from({ length: T + 1 }, (_, i) => String(i));
  const delta = deriveSeries(agg.deltaAcc, T);
  const tc = themeColors();

  const series = [
    {
      name: "Min",
      type: "line",
      data: delta.min,
      stack: "delta-band",
      lineStyle: { opacity: 0 },
      symbol: "none",
      silent: true,
      tooltip: { show: false },
      z: 1,
    },
    {
      name: "Max\u2212Min",
      type: "line",
      data: delta.min.map((v, i) => (v == null || delta.max[i] == null ? null : delta.max[i] - v)),
      stack: "delta-band",
      lineStyle: { opacity: 0 },
      areaStyle: { color: hexToRgba("#FF7F0E", 0.1) },
      symbol: "none",
      silent: true,
      tooltip: { show: false },
      z: 1,
    },
    {
      name: "Buy\u2212Rent Delta",
      type: "line",
      data: delta.mean,
      lineStyle: { color: "#FF7F0E", width: 2.2 },
      itemStyle: { color: "#FF7F0E" },
      smooth: 0.25,
      symbol: "none",
      showSymbol: false,
      z: 3,
      markLine: {
        symbol: "none",
        silent: true,
        data: [{ yAxis: 0, lineStyle: { color: tc.textMuted, type: "dashed", width: 1 } }],
      },
    },
  ];

  const mkLine = eventsToMarkLine(events);
  const mkArea = eventsToMarkArea(events);
  // Attach events to the first silent series so they show behind the line
  if (mkLine) series[0].markLine = mkLine;
  if (mkArea) series[0].markArea = mkArea;

  const axes = axisCommon(tc);
  axes.xAxis.data = years;
  axes.yAxis.name = "Delta (CHF)";
  axes.yAxis.nameLocation = "middle";
  axes.yAxis.nameGap = 45;

  const inst = getOrCreate("chart-delta");
  if (!inst) return;
  inst.setOption({
    animation: true,
    animationDuration: 300,
    grid: gridOption(false),
    tooltip: tooltipCommon(tc),
    xAxis: axes.xAxis,
    yAxis: axes.yAxis,
    dataZoom: dataZoomCommon(false),
    series,
  }, { notMerge: true });
}

function renderDeltaChangeChart(agg, events) {
  const T = agg.T;
  const years = Array.from({ length: T + 1 }, (_, i) => String(i));
  const delta = deriveSeries(agg.deltaAcc, T);
  const change = delta.mean.map((v, t) => (t === 0 || v == null || delta.mean[t - 1] == null ? 0 : v - delta.mean[t - 1]));
  const tc = themeColors();

  const series = [
    {
      name: "Annual \u0394 Change",
      type: "bar",
      data: change.map((v) => ({
        value: v,
        itemStyle: {
          color: v >= 0 ? "rgba(44,160,44,0.75)" : "rgba(214,39,40,0.75)",
          borderRadius: [3, 3, 0, 0],
        },
      })),
      barMaxWidth: 14,
    },
  ];

  const mkLine = eventsToMarkLine(events);
  const mkArea = eventsToMarkArea(events);
  if (mkLine) series[0].markLine = mkLine;
  if (mkArea) series[0].markArea = mkArea;

  const axes = axisCommon(tc);
  axes.xAxis.data = years;
  axes.yAxis.name = "YoY Gap Change (CHF)";
  axes.yAxis.nameLocation = "middle";
  axes.yAxis.nameGap = 45;

  const inst = getOrCreate("chart-cumulative");
  if (!inst) return;
  inst.setOption({
    animation: true,
    animationDuration: 300,
    grid: gridOption(false),
    tooltip: tooltipCommon(tc),
    xAxis: axes.xAxis,
    yAxis: axes.yAxis,
    dataZoom: dataZoomCommon(false),
    series,
  }, { notMerge: true });
}

function renderWinShareChart(agg, events) {
  const T = agg.T;
  const years = Array.from({ length: T + 1 }, (_, i) => String(i));
  const n = agg.totalCount;
  const buyWinPct = years.map((_, t) => (agg.buyWinCount[t] / n) * 100);
  const tc = themeColors();

  const series = [
    {
      name: "Buy Win %",
      type: "line",
      data: buyWinPct,
      lineStyle: { color: "#FF7F0E", width: 2.2 },
      itemStyle: { color: "#FF7F0E" },
      areaStyle: { color: hexToRgba("#FF7F0E", 0.12) },
      symbol: "none",
      showSymbol: false,
      smooth: 0.25,
      z: 3,
      markLine: {
        symbol: "none",
        silent: true,
        data: [{ yAxis: 50, lineStyle: { color: tc.textMuted, type: "dashed", width: 1 } }],
      },
    },
  ];

  const mkLine = eventsToMarkLine(events);
  const mkArea = eventsToMarkArea(events);
  // Chain event markLines into the existing one if present
  if (mkLine) {
    const existing = series[0].markLine.data;
    series[0].markLine = {
      symbol: "none",
      silent: true,
      animation: false,
      data: existing.concat(mkLine.data),
    };
  }
  if (mkArea) series[0].markArea = mkArea;

  const axes = axisCommon(tc);
  axes.xAxis.data = years;
  axes.yAxis.name = "Buy Win %";
  axes.yAxis.min = 0;
  axes.yAxis.max = 100;
  axes.yAxis.axisLabel = { ...axes.yAxis.axisLabel, formatter: "{value}%" };
  axes.yAxis.nameLocation = "middle";
  axes.yAxis.nameGap = 45;

  const inst = getOrCreate("chart-winshare");
  if (!inst) return;
  inst.setOption({
    animation: true,
    animationDuration: 300,
    grid: gridOption(false),
    tooltip: {
      ...tooltipCommon(tc),
      formatter: (params) => {
        const p = params.find((x) => x.seriesName === "Buy Win %");
        if (!p) return "";
        return `<div style="font-weight:600;margin-bottom:4px;">Year ${p.axisValueLabel ?? p.axisValue}</div>Buy Win: <b>${p.value.toFixed(1)}%</b>`;
      },
    },
    xAxis: axes.xAxis,
    yAxis: axes.yAxis,
    dataZoom: dataZoomCommon(false),
    series,
  }, { notMerge: true });
}

function renderHistogram(agg) {
  const tc = themeColors();
  const nBins = agg.histBins.length;
  const binLabels = [];
  for (let i = 0; i < nBins; i++) {
    const mid = agg.histMin + (i + 0.5) * agg.histBinWidth;
    binLabels.push(fmtCHF(mid));
  }

  const series = [
    {
      name: "Count",
      type: "bar",
      data: Array.from(agg.histBins).map((count, i) => {
        const mid = agg.histMin + (i + 0.5) * agg.histBinWidth;
        return {
          value: count,
          itemStyle: {
            color: mid >= 0 ? "rgba(255,127,14,0.78)" : "rgba(31,119,180,0.78)",
            borderRadius: [3, 3, 0, 0],
          },
        };
      }),
      barCategoryGap: "10%",
    },
  ];

  const inst = getOrCreate("chart-histogram");
  if (!inst) return;

  // The histogram is NOT in the connected group (different x-axis semantics)
  inst.group = "";

  inst.setOption({
    animation: true,
    animationDuration: 300,
    grid: { left: 58, right: 18, top: 16, bottom: 40, containLabel: false },
    tooltip: {
      ...tooltipCommon(tc),
      formatter: (params) => {
        const p = params[0];
        return `<div style="font-weight:600;margin-bottom:4px;">${p.name}</div>Count: <b>${p.value}</b>`;
      },
    },
    xAxis: {
      type: "category",
      data: binLabels,
      axisLine: { lineStyle: { color: tc.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: tc.textMuted, fontSize: 10, rotate: 30, interval: Math.max(0, Math.floor(nBins / 10) - 1) },
      name: "End Delta (Buy\u2212Rent)",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: tc.textMuted, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tc.textMuted, fontSize: 11 },
      splitLine: { lineStyle: { color: tc.split, type: "dashed" } },
      name: "# Scenarios",
      nameLocation: "middle",
      nameGap: 45,
      nameTextStyle: { color: tc.textMuted, fontSize: 11 },
    },
    series,
  }, { notMerge: true });
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
  const inst = charts[canvasId];
  if (!inst) return;
  const url = inst.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: themeColors().bg,
  });
  const link = document.createElement("a");
  link.download = canvasId + ".png";
  link.href = url;
  link.click();
}

export function destroyAllCharts() {
  for (const [id, inst] of Object.entries(charts)) {
    inst.dispose();
    delete charts[id];
  }
}

// ---- Resize handling ----

let resizeHandlerRegistered = false;
function registerResize() {
  if (resizeHandlerRegistered) return;
  resizeHandlerRegistered = true;
  window.addEventListener("resize", () => {
    for (const inst of Object.values(charts)) {
      try { inst.resize(); } catch (_) { /* ignore */ }
    }
  });
}
registerResize();
